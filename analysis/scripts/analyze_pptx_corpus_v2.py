import json
import math
import posixpath
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(r"C:\Users\GB\Desktop\PPT_PERIODE_4")
OUT_DIR = Path(r"C:\Users\GB\Desktop\PPT_PERIODE_4\Exemple")
JSON_OUT = OUT_DIR / "pptx_analysis_all_levels_v2.json"
MD_OUT = OUT_DIR / "analyse_pptx_math_all_levels_v2.md"

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

LEVEL_DIRS = [ROOT / f"N{i}" for i in range(1, 7)]
FILES = []
for level_dir in LEVEL_DIRS:
    FILES.extend(sorted(level_dir.glob("*.pptx")))

CORRECTION_RE = re.compile(r"صحح(?:وا|ي|وا\.)")
QUESTION_HINTS = [
    "احسب",
    "احسبوا",
    "اكتب",
    "اكتبوا",
    "اقرأ",
    "اقرؤوا",
    "أكمل",
    "أكملوا",
    "أنجز",
    "أنجزوا",
    "حدد",
    "حددوا",
    "عين",
    "عينوا",
    "اختر",
    "اختاروا",
    "صل",
    "صلوا",
    "رتب",
    "رتبوا",
    "املأ",
    "املؤوا",
    "نظموا",
    "ماذا نفعل",
    "ما هو",
    "من يقرأ",
    "نوع الزاوية",
    "نوع المثلث",
]
GENERIC_PROMPTS = [
    "ارفعوا الألواح",
    "ارفعوا ألواحكم",
    "خذوا ألواحكم",
    "خذوا الألواح",
    "خذوا كراساتكم",
    "خذوا الكراسات",
    "خذوا دفاتر",
    "الآن ستشتغلون في ثنائيات",
    "كل واحد يقارن إنجازه",
    "انتظروا الانطلاقة",
]
META_SLIDE_MARKERS = [
    "خاص بالأستاذ",
    "أيقونات توجيهية",
    "توجيهات",
    "برمجة الأسبوع",
    "درس اليوم",
    "مراحل الدرس",
    "عند نهاية الدرس",
    "مرحباً",
    "اختتام الدرس",
    "افتتاح الدرس",
]
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def parse_xml(zf, name):
    return ET.fromstring(zf.read(name))


def rels_map(zf, rels_path):
    if rels_path not in zf.namelist():
        return {}
    root = parse_xml(zf, rels_path)
    out = {}
    for rel in root.findall("{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"):
        out[rel.attrib["Id"]] = rel.attrib.get("Target", "")
    return out


def norm_target(base_path, target):
    return posixpath.normpath(posixpath.join(posixpath.dirname(base_path), target))


def extract_text(root):
    texts = []
    for elem in root.findall(".//a:t", NS):
        if elem.text:
            text = re.sub(r"\s+", " ", elem.text).strip()
            if text:
                texts.append(text)
    return texts


def join_text(texts):
    return " | ".join(t for t in texts if t)


def normalize_text(text):
    return text.translate(ARABIC_DIGITS)


def extract_numbers(text):
    return set(re.findall(r"\d+(?::\d+)?", normalize_text(text)))


def meaningful_tokens(text):
    text = normalize_text(text)
    tokens = re.findall(r"[\u0600-\u06FFA-Za-z0-9%]+", text)
    stop = {
        "على", "في", "من", "إلى", "ثم", "هذا", "هذه", "ذلك", "التي", "الذي",
        "مع", "هو", "هي", "كم", "لقد", "الآن", "جيدا", "جيداً", "مثل", "جدا",
        "تماما", "تماماً", "رقم", "عدد", "الألواح", "ألواحكم", "صححوا",
    }
    return {t for t in tokens if len(t) > 1 and t not in stop}


def is_correction_slide(text):
    return bool(CORRECTION_RE.search(text))


def is_generic_prompt(text):
    return any(marker in text for marker in GENERIC_PROMPTS)


def is_question_slide(text):
    if is_correction_slide(text) or not text.strip():
        return False
    if any(marker in text for marker in META_SLIDE_MARKERS):
        return False
    if is_generic_prompt(text):
        return False
    if (
        "الصفحة" in text
        and any(marker in text for marker in ["أنجزوا النشاط", "خذوا كراساتكم", "خذوا الكراسات", "سأمر بين الصفوف"])
        and not re.search(r"[=×x+\-]|[?؟]|\.{2,}|…", text)
    ):
        return False
    if "برمجة" in text or "مراجعة دروس" in text:
        return False
    if any(marker in text for marker in QUESTION_HINTS):
        return True
    if re.search(r"[=×x+\-]\s*(?:…|\.{2,}|\.|[?؟])", text):
        return True
    return False


def extract_slides(pptx_path):
    with zipfile.ZipFile(pptx_path) as zf:
        pres = parse_xml(zf, "ppt/presentation.xml")
        pres_rels = rels_map(zf, "ppt/_rels/presentation.xml.rels")
        ordered_slides = []
        for sld_id in pres.findall(".//p:sldId", NS):
            rid = sld_id.attrib.get(f"{{{NS['r']}}}id")
            target = pres_rels.get(rid)
            if target:
                ordered_slides.append(norm_target("ppt/presentation.xml", target))

        slides = []
        for index, slide_path in enumerate(ordered_slides, 1):
            slide = parse_xml(zf, slide_path)
            texts = extract_text(slide)
            slide_rels_path = posixpath.join(
                posixpath.dirname(slide_path),
                "_rels",
                posixpath.basename(slide_path) + ".rels",
            )
            srels = rels_map(zf, slide_rels_path)
            pics = len(slide.findall(".//p:pic", NS))
            tables = len(slide.findall(".//a:tbl", NS))
            charts = sum(1 for target in srels.values() if "chart" in target)
            slide_text = join_text(texts)
            slides.append(
                {
                    "index": index,
                    "text": slide_text,
                    "pic_count": pics,
                    "table_count": tables,
                    "chart_count": charts,
                    "numbers": extract_numbers(slide_text),
                    "tokens": meaningful_tokens(slide_text),
                    "is_correction": is_correction_slide(slide_text),
                    "is_question": is_question_slide(slide_text),
                    "is_generic": is_generic_prompt(slide_text),
                }
            )
    return slides


def correction_score(question_slide, correction_slide):
    distance = correction_slide["index"] - question_slide["index"]
    if distance < 1 or distance > 3:
        return -math.inf

    score = 0.0
    score += {1: 3.0, 2: 2.0, 3: 1.0}[distance]

    shared_numbers = question_slide["numbers"] & correction_slide["numbers"]
    score += len(shared_numbers) * 2.0

    shared_tokens = question_slide["tokens"] & correction_slide["tokens"]
    score += min(len(shared_tokens), 4) * 0.5

    if re.search(r"[=×x+\-]", question_slide["text"]) and re.search(r"[=×x+\-]", correction_slide["text"]):
        score += 1.0
    if "?" in question_slide["text"] or "؟" in question_slide["text"]:
        score += 0.5
    if question_slide["is_generic"]:
        score -= 2.0
    if shared_numbers:
        score += 1.0

    return score


def build_question_correction_pairs(slides):
    question_indices = [i for i, slide in enumerate(slides) if slide["is_question"]]
    correction_indices = [i for i, slide in enumerate(slides) if slide["is_correction"]]

    correction_to_question = {}
    question_to_correction = {}
    pair_records = []

    for c_idx in correction_indices:
        correction = slides[c_idx]
        candidates = []
        for q_idx in range(max(0, c_idx - 3), c_idx):
            question = slides[q_idx]
            if not question["is_question"]:
                continue
            score = correction_score(question, correction)
            if score > -math.inf:
                candidates.append((score, q_idx))
        if not candidates:
            continue
        candidates.sort(reverse=True)
        best_score, best_q_idx = candidates[0]
        if best_score < 2.5:
            continue
        previous = question_to_correction.get(best_q_idx)
        if previous is not None and previous["score"] >= best_score:
            continue
        if previous is not None:
            old_c_idx = previous["correction_idx"]
            correction_to_question.pop(old_c_idx, None)
        question_to_correction[best_q_idx] = {"correction_idx": c_idx, "score": best_score}
        correction_to_question[c_idx] = best_q_idx

    for q_idx in question_indices:
        question = slides[q_idx]
        match = question_to_correction.get(q_idx)
        if match is None:
            pair_records.append(
                {
                    "question_slide": question["index"],
                    "question_text": question["text"][:240],
                    "correction_found": False,
                    "correction_slide": None,
                    "correction_text": None,
                    "score": None,
                }
            )
        else:
            correction = slides[match["correction_idx"]]
            pair_records.append(
                {
                    "question_slide": question["index"],
                    "question_text": question["text"][:240],
                    "correction_found": True,
                    "correction_slide": correction["index"],
                    "correction_text": correction["text"][:240],
                    "score": round(match["score"], 2),
                }
            )

    return pair_records, question_indices, correction_indices


def infer_structure(slides):
    text = " ".join(slide["text"] for slide in slides)
    mapping = [
        ("افتتاح الدرس", "ouverture"),
        ("الحساب الذهني", "calcul mental"),
        ("النمذجة", "modélisation"),
        ("ممارسة موجهة", "pratique guidée"),
        ("الممارسة الموجهة", "pratique guidée"),
        ("ممارسة مستقلة", "pratique autonome"),
        ("الممارسة المستقلة", "pratique autonome"),
        ("اختتام الدرس", "clôture"),
    ]
    phases = []
    for arabic, french in mapping:
        if arabic in text and french not in phases:
            phases.append(french)
    return phases


def detect_exercise_types(slides):
    buckets = defaultdict(list)
    for slide in slides:
        text = slide["text"]
        if not text:
            continue
        if any(k in text for k in ["اكتبوا رقم الإجابة الصحيحة", "الإجابة الصحيحة"]):
            buckets["QCM"].append(slide)
        if any(k in text for k in ["احسب", "احسبوا", "×", "x 10", "ناقص", "+", "-", "="]):
            buckets["Calcul / réponse courte"].append(slide)
        if any(k in text for k in ["أكملوا", "أتموا", ".. :", "…", "..."]):
            buckets["Exercice à trous / complétion"].append(slide)
        if any(k in text for k in ["ما هو", "مسألة", "اشترى", "اشترت", "ثمن", "المبلغ", "مقابل"]) and len(text) > 40:
            buckets["Problème narratif"].append(slide)
        if any(k in text for k in ["أصل", "نصلها", "الموافقة لها"]):
            buckets["Correspondance / appariement"].append(slide)
        if any(k in text for k in ["جدول", "نظموا معطيات", "ملء الجدول"]) or slide["table_count"] > 0:
            buckets["Tableau / organisation de données"].append(slide)
        if any(k in text for k in ["نوع الزاوية", "نوع المثلث", "يشير إليه", "من بين هذه المثلثات", "من يقرأ الساعة", "اللون الذي يمثل", "نسبة التلاميذ"]):
            buckets["Identification visuelle"].append(slide)
    return buckets


def choose_examples(slides, limit=2):
    examples = []
    seen = set()
    for slide in slides:
        text = slide["text"].strip()
        if len(text) < 8:
            continue
        key = text[:180]
        if key in seen:
            continue
        seen.add(key)
        examples.append({"slide": slide["index"], "text": text[:220]})
        if len(examples) >= limit:
            break
    return examples


def topic_hint(slides):
    for slide in slides[:8]:
        text = slide["text"]
        if "درس اليوم" in text:
            cleaned = text.replace("درس اليوم", "").replace("( | ة | ) | خاص بالأستاذ", "").strip(" |")
            return cleaned[:140]
    return ""


def language_complexity(slides):
    texts = [s["text"] for s in slides if s["text"]]
    avg_len = sum(len(t) for t in texts) / max(1, len(texts))
    pic_ratio = sum(1 for s in slides if s["pic_count"] > 0) / max(1, len(slides))
    if avg_len > 80:
        level = "intermédiaire"
    else:
        level = "simple"
    if pic_ratio > 0.7:
        support = "avec fort support visuel"
    elif pic_ratio > 0.4:
        support = "avec support visuel régulier"
    else:
        support = "plutôt textuel"
    return f"français de consigne transposé depuis l’arabe : niveau {level}, {support}"


def analyze_file(pptx_path):
    slides = extract_slides(pptx_path)
    pairs, question_indices, correction_indices = build_question_correction_pairs(slides)
    types = detect_exercise_types(slides)
    matched = sum(1 for pair in pairs if pair["correction_found"])
    total = len(pairs)
    unmatched = total - matched
    match_rate = (matched / total) if total else 0.0

    return {
        "file": pptx_path.name,
        "folder": pptx_path.parent.name,
        "slide_count": len(slides),
        "topic_hint": topic_hint(slides),
        "phases": infer_structure(slides),
        "exercise_types": {name: choose_examples(items, 2) for name, items in types.items()},
        "language_complexity": language_complexity(slides),
        "non_textual": {
            "slides_with_pics": sum(1 for s in slides if s["pic_count"] > 0),
            "slides_with_tables": sum(1 for s in slides if s["table_count"] > 0),
            "slides_with_charts": sum(1 for s in slides if s["chart_count"] > 0),
        },
        "question_count": total,
        "correction_slide_count": len(correction_indices),
        "matched_question_count": matched,
        "unmatched_question_count": unmatched,
        "match_rate": match_rate,
        "question_correction_pairs": pairs,
    }


def render_markdown(reports, failed_files):
    lines = []
    lines.append("# Analyse des fichiers PowerPoint de mathématiques - corpus complet N1 à N6 (v2)")
    lines.append("")
    lines.append(f"Nombre total de fichiers analysés avec succès : **{len(reports)}**")
    lines.append(f"Fichiers ignorés : **{len(failed_files)}**")
    lines.append("")
    if failed_files:
        lines.append("## Fichiers ignorés")
        lines.append("")
        for item in failed_files:
            lines.append(f"- `{Path(item['file']).name}` : `{item['error']}`")
        lines.append("")

    by_folder = defaultdict(list)
    for report in reports:
        by_folder[report["folder"]].append(report)

    for folder in sorted(by_folder):
        lines.append(f"## Dossier {folder}")
        lines.append("")
        for report in by_folder[folder]:
            lines.append(f"### {report['file']}")
            lines.append("")
            lines.append("**1. Métadonnées**")
            lines.append(f"- Nom du fichier : `{report['file']}`")
            lines.append(f"- Niveau scolaire : `{report['folder']}`")
            lines.append(f"- Nombre de slides : `{report['slide_count']}`")
            if report["topic_hint"]:
                lines.append(f"- Thème probable détecté : `{report['topic_hint']}`")
            lines.append("")
            lines.append("**2. Structure générale**")
            if report["phases"]:
                lines.append(f"- Structure répétitive détectée, avec une trame proche de : {', '.join(report['phases'])}.")
            else:
                lines.append("- Structure non détectée automatiquement avec assez de fiabilité.")
            lines.append("")
            lines.append("**3. Types d’exercices présents**")
            if report["exercise_types"]:
                for exercise_type, examples in sorted(report["exercise_types"].items()):
                    lines.append(f"- {exercise_type}.")
                    for example in examples:
                        lines.append(f"  Extrait slide {example['slide']} : `{example['text']}`")
            else:
                lines.append("- Aucun type n’a été catégorisé automatiquement avec confiance.")
            lines.append("")
            lines.append("**4. Appariement question / correction**")
            lines.append(
                f"- `{report['matched_question_count']}/{report['question_count']}` questions ont une correction identifiée "
                f"({report['match_rate'] * 100:.1f}%)."
            )
            lines.append(f"- Slides de correction détectées via `صححوا` : `{report['correction_slide_count']}`")
            sample_pairs = [pair for pair in report["question_correction_pairs"] if pair["correction_found"]][:2]
            sample_misses = [pair for pair in report["question_correction_pairs"] if not pair["correction_found"]][:1]
            for pair in sample_pairs:
                lines.append(
                    f"- Appariement : question slide {pair['question_slide']} -> correction slide {pair['correction_slide']} "
                    f"(score {pair['score']})."
                )
                lines.append(f"  Question : `{pair['question_text']}`")
                lines.append(f"  Correction : `{pair['correction_text']}`")
            for pair in sample_misses:
                lines.append(
                    f"- Correction non trouvée pour la question slide {pair['question_slide']} : "
                    f"`{pair['question_text']}`"
                )
            lines.append("")
            lines.append("**5. Niveau de complexité du langage**")
            lines.append(f"- {report['language_complexity']}")
            lines.append("")
            lines.append("**6. Éléments non-textuels**")
            non_textual = report["non_textual"]
            lines.append(f"- Slides avec images : `{non_textual['slides_with_pics']}/{report['slide_count']}`")
            lines.append(f"- Slides avec tableaux OpenXML : `{non_textual['slides_with_tables']}`")
            lines.append(f"- Slides avec graphiques/diagrammes liés : `{non_textual['slides_with_charts']}`")
            if (
                non_textual["slides_with_charts"] > 0
                or non_textual["slides_with_tables"] > 0
                or non_textual["slides_with_pics"] / max(1, report["slide_count"]) > 0.7
            ):
                lines.append("- Dépendance visuelle notable ; extraction purement textuelle partiellement limitée.")
            else:
                lines.append("- Dépendance visuelle plus modérée ; extraction texte -> JSON plus réaliste.")
            lines.append("")

    total_questions = sum(report["question_count"] for report in reports)
    total_matched = sum(report["matched_question_count"] for report in reports)
    global_rate = (total_matched / total_questions) if total_questions else 0.0
    weakest = sorted(
        [report for report in reports if report["question_count"] > 0],
        key=lambda report: (report["match_rate"], report["question_count"]),
    )[:15]

    lines.append("## Synthèse transversale")
    lines.append("")
    lines.append(
        f"- Taux global d’appariement question/correction : `{total_matched}/{total_questions}` "
        f"({global_rate * 100:.1f}%)."
    )
    lines.append("- Le calcul repose sur des slides de correction détectées via `صححوا` puis appariées aux questions dans une fenêtre de 1 à 3 slides avant.")
    lines.append("- Quand aucun appariement fiable n’est trouvé, la question est marquée individuellement comme `correction non trouvée` au lieu d’invalider tout le fichier.")
    lines.append("")
    lines.append("**Fichiers au taux d’appariement le plus faible**")
    for report in weakest:
        lines.append(
            f"- `{report['folder']}/{report['file']}` : "
            f"`{report['matched_question_count']}/{report['question_count']}` "
            f"({report['match_rate'] * 100:.1f}%)."
        )

    return "\n".join(lines)


def main():
    reports = []
    failed_files = []
    for pptx_path in FILES:
        try:
            reports.append(analyze_file(pptx_path))
        except Exception as exc:
            failed_files.append({"file": str(pptx_path), "error": str(exc)})

    reports.sort(key=lambda report: (report["folder"], report["file"]))

    total_questions = sum(report["question_count"] for report in reports)
    total_matched = sum(report["matched_question_count"] for report in reports)
    global_rate = (total_matched / total_questions) if total_questions else 0.0

    JSON_OUT.write_text(
        json.dumps(
            {
                "file_count": len(reports),
                "failed_count": len(failed_files),
                "failed_files": failed_files,
                "total_questions": total_questions,
                "total_matched_questions": total_matched,
                "global_match_rate": global_rate,
                "reports": reports,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    MD_OUT.write_text(render_markdown(reports, failed_files), encoding="utf-8")
    print(f"success={len(reports)} failed={len(failed_files)} total_questions={total_questions} matched={total_matched} rate={global_rate:.4f}")
    print(JSON_OUT)
    print(MD_OUT)


if __name__ == "__main__":
    main()

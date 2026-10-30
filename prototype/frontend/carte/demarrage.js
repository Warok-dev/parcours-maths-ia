/* carte/demarrage.js — Menu, branchements d'interface, contrôles tactiles, API ParcoursApp, démarrage.
   Partie de l'ancien map.js : scripts classiques chargés dans l'ordre par
   index.html (portée globale partagée, sans étape de build). Voir carte/LISEZMOI.md. */

/* ============================================================
   MENU DU HUD
   ============================================================ */
function closeMenuDropdown() {
  menuDropdown.classList.add("hidden");
  menuButton.setAttribute("aria-expanded", "false");
}

const muteButton = document.getElementById("mute-button");
if (window.ParcoursAudio?.isMuted()) {
  muteButton.classList.add("muted");
  muteButton.setAttribute("aria-pressed", "true");
}
muteButton.addEventListener("click", () => {
  const muted = window.ParcoursAudio?.toggleMute() ?? false;
  muteButton.classList.toggle("muted", muted);
  muteButton.setAttribute("aria-pressed", String(muted));
});

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const isHidden = menuDropdown.classList.toggle("hidden");
  menuButton.setAttribute("aria-expanded", String(!isHidden));
});

document.addEventListener("click", (event) => {
  if (!menuDropdown.classList.contains("hidden") && !menuDropdown.contains(event.target)) {
    closeMenuDropdown();
  }
});

/* Animations : auto -> vivant -> econome (perf.js). Le menu reste ouvert
   pour qu'on voie le nouveau reglage ; la carte est redessinee (le mode
   econome n'y dessine pas les elements animes). */
const animationsButton = document.getElementById("animations-button");
function majBoutonAnimations() {
  const label = document.getElementById("animations-label");
  if (label && window.ParcoursPerf) {
    label.textContent = window.ParcoursPerf.libelle();
  }
}
majBoutonAnimations();
animationsButton?.addEventListener("click", () => {
  const perf = window.ParcoursPerf;
  if (!perf) {
    return;
  }
  perf.definir(perf.choixSuivant(perf.choix()));
  majBoutonAnimations();
});
window.ParcoursPerf?.surChangement(() => {
  majBoutonAnimations();
  if (state.session && state.scene) {
    renderScene();
  }
});

/* ============================================================
   BRANCHEMENTS UI
   ============================================================ */
document.querySelectorAll(".level-button").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await loadLessons(button.dataset.level);
    } catch (error) {
      startStatus.textContent = `Impossible de demarrer la session : ${error.message}`;
    }
  });
});

restartButton.addEventListener("click", () => {
  closeMenuDropdown();
  resetToStart();
});

document.getElementById("new-adventure-button").addEventListener("click", () => {
  closeMenuDropdown();
  /* resetToStart efface aussi la reference de session en localStorage. */
  resetToStart();
});

/* Changer de joueur : on oublie le compte courant et on recharge, ce qui
   ramene a l'ecran de connexion (rejoindre une classe ou essai libre). */
document.getElementById("compte-button").addEventListener("click", () => {
  closeMenuDropdown();
  window.ParcoursCompte?.deconnecter?.();
  window.location.reload();
});

window.addEventListener("beforeunload", saveSessionRef);

changeLessonButton.addEventListener("click", () => {
  closeMenuDropdown();
  returnToLessonChoice();
});

backToLevelsButton.addEventListener("click", resetToStart);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
/* La couche carte (P5) epingle des px : au redimensionnement/rotation, on
   recalcule son echelle, sa taille et la super-fenetre (sans toucher a la
   camera ni au monde). Ignore si le jeu n'est pas a l'ecran. */
function handleViewportResize() {
  if (!gameScreen.classList.contains("hidden")) {
    setupMapLayer();
  }
}
window.addEventListener("resize", handleViewportResize);
window.addEventListener("orientationchange", handleViewportResize);

/* ============================================================
   CONTROLES TACTILES : joystick analogique + bouton d'action
   Sur appareil tactile uniquement. Le joystick ecrit state.joystick
   (direction libre + force), lu par movementVector() : glisser = avancer dans
   la direction du doigt, plus ou moins vite selon l'inclinaison ; relacher =
   arret. Le bouton d'action ouvre l'exercice pres d'un obstacle/fanion
   (equivalent tactile de la touche Entree). Voir touch.js (coeur teste).
   ============================================================ */
let joystickTactile = { reinitialiser() {} };
if (estAppareilTactile) {
  document.body.classList.add("touch-active");
  joystickTactile = window.ParcoursTouch.brancherJoystick(
    {
      zone: touchDpad?.querySelector("[data-joystick-zone]"),
      base: touchDpad?.querySelector("[data-joystick-base]"),
      bouton: touchDpad?.querySelector("[data-joystick-bouton]"),
    },
    {
      changer: (v) => {
        state.joystick = state.panelOpen ? null : v;
      },
      relacher: () => {
        state.joystick = null;
      },
    },
  );
  /* pointerup plutot que click : reponse immediate au doigt, sans le delai ni
     le risque de double-declenchement du click synthetique. */
  touchActionButton?.addEventListener("pointerup", (event) => {
    event.preventDefault();
    if (state.nearObstacle && !state.panelOpen) {
      openExercisePanel();
    }
  });
  touchActionButton?.addEventListener("contextmenu", (event) => event.preventDefault());
}

/* Affiche/masque le pave et le bouton d'action selon l'etat courant (en jeu,
   popup ouverte, proximite d'un obstacle). Appelee aux transitions d'etat :
   entree en jeu, ouverture/fermeture d'exercice, changement de proximite. */
function majControlesTactiles() {
  if (!estAppareilTactile || !window.ParcoursTouch) {
    return;
  }
  const enJeu = Boolean(state.session) && !gameScreen.classList.contains("hidden");
  const contexte = { actif: true, enJeu, panneauOuvert: state.panelOpen };
  window.ParcoursTouch.appliquerVisibilite(touchDpad, window.ParcoursTouch.dpadVisible(contexte));
  window.ParcoursTouch.appliquerVisibilite(
    touchActionButton,
    window.ParcoursTouch.actionVisible({ ...contexte, presObstacle: state.nearObstacle }),
  );
  /* Masque (popup, fin de partie) : le personnage ne doit pas continuer seul. */
  if (!enJeu || state.panelOpen) {
    joystickTactile.reinitialiser();
    state.joystick = null;
  }
}

/* Fresque du monde : une scene fixe (ciel, herbe, route, chateau, arbres)
   composee a partir des memes briques SVG que la carte (ASSETS.castle,
   tree, bush, flower, rock) et des couleurs du jeu. Sert d'image de base au
   mini-jeu puzzle, qui la decoupe en pieces. ViewBox de reference : 300x240. */
function worldFresqueMarkup() {
  return `
    <rect x="0" y="0" width="300" height="240" fill="#bfe6f5"></rect>
    <circle cx="250" cy="44" r="24" fill="#ffd66b"></circle>
    <circle cx="250" cy="44" r="24" fill="none" stroke="#ffc23e" stroke-width="4" opacity="0.55"></circle>
    <ellipse cx="70" cy="152" rx="120" ry="58" fill="#85d066"></ellipse>
    <ellipse cx="252" cy="156" rx="128" ry="52" fill="#7ac95e"></ellipse>
    <rect x="0" y="150" width="300" height="90" fill="#6fbe53"></rect>
    <path d="M 128 240 L 172 240 L 158 152 L 142 152 Z" fill="#e8703a"></path>
    <path d="M 142 152 L 158 152 L 156 166 L 144 166 Z" fill="#f5905c" opacity="0.7"></path>
    <g transform="translate(150,120) scale(0.5)">${ASSETS.castle(true)}</g>
    <g transform="translate(38,168) scale(0.7)">${ASSETS.tree()}</g>
    <g transform="translate(266,172) scale(0.62)">${ASSETS.tree()}</g>
    <g transform="translate(95,204) scale(0.6)">${ASSETS.bush()}</g>
    <g transform="translate(208,208) scale(0.58)">${ASSETS.bush()}</g>
    <g transform="translate(58,220) scale(1)">${ASSETS.flower()}</g>
    <g transform="translate(238,206) scale(1)">${ASSETS.flowerPink()}</g>
    <g transform="translate(20,142) scale(0.7)">${ASSETS.rock()}</g>
  `;
}

window.ParcoursApp = {
  getSessionId: () => state.sessionId,
  getCurrentExercise: () => state.currentExercise,
  getSessionLevel: () => levelLabel(),
  getSessionSnapshot: () => state.session,
  syncSession,
  setFeedback,
  isPanelOpen: () => state.panelOpen,
  isNearObstacle: () => state.nearObstacle,
  getPlayerPosition: () => ({ ...state.playerPosition }),
  getActiveObstacle: () => {
    const obstacle = activeObstacle();
    return obstacle ? { x: obstacle.x, y: obstacle.barrierY, type: obstacle.type } : null;
  },
  getReinforcement: () => state.reinforcement,
  getInteractionTarget: () => interactionTarget(),
  openExercisePanel,
  refreshScenePaused,
  /* Fin de parcours (bilan carnet.js) : le bouton principal ramene au choix
     de lecon du meme niveau (assignations rafraichies + priorisees), les
     options secondaires vers le choix de niveau. "Changer de niveau" n'a pas
     de sens pour un eleve connecte (niveau fige par sa classe) : le bilan le
     masque via estEleveConnecte. */
  returnToLessonChoice,
  resetToStart,
  estEleveConnecte: () => Boolean(niveauImposeEleve()),
  /* Pause mini-jeu : on reutilise panelOpen (qui fige deja le mouvement et
     les interactions dans la boucle de jeu) pour immobiliser la carte le
     temps de l'aparte detente. La position et la camera ne bougent pas :
     le retour se fait donc exactement la ou l'on etait. */
  mettreEnPausePourMinigame: () => {
    state.panelOpen = true;
    refreshScenePaused();
    majControlesTactiles();
  },
  reprendreApresMinigame: () => {
    state.panelOpen = false;
    refreshScenePaused();
    majControlesTactiles();
  },
  /* Bonus purement cosmetique d'un mini-jeu : alimente les memes etoiles
     que le tresor de l'excellence (garde-robe), jamais la maitrise ni la
     progression pedagogique. */
  ajouterBonusCosmetique: (points) => addScore(points),
  /* Personnalisation : le dessin du personnage et son rafraichissement sur
     la carte restent proprietes de map.js, qui possede la scene. */
  playerMarkup: () => ASSETS.player(),
  refreshPlayerToken,
  /* Fresque du monde (chateau, route, decor) pour le mini-jeu puzzle :
     composee des memes briques SVG que la carte. */
  fresqueMondeMarkup: () => worldFresqueMarkup(),
  /* Variante mature (CE5/CE6) appliquee au sous-arbre d'un mini-jeu monte. */
  appliquerVarianteMinijeu: (element) => durcirAnglesRectsDom(element),
  varianteMature: () => varianteMature(),
};

if (!animationFrameId) {
  animationFrameId = window.requestAnimationFrame(tick);
}

/* Changement d'univers en cours de partie : on revient exactement d'ou l'on
   vient (la carte si une partie tourne, sinon l'ecran ou l'on etait). Le
   theme s'appliquera aux prochains problemes narratifs generes. */
if (window.ParcoursTheme) {
  window.ParcoursTheme.demanderChangement = () => {
    const enJeu = Boolean(state.sessionId);
    window.ParcoursTheme.ouvrir({
      titre: "Changer d'univers",
      retour: true,
      apresChoix: () => {
        if (enJeu) {
          showGameScreen();
          setFeedback(
            "Nouvel univers choisi ! Il habillera tes prochaines histoires.",
            "success",
          );
        } else if (state.selectedLevel) {
          showLessonScreen();
        } else {
          showStartScreen();
        }
      },
    });
  };
}

/* Au chargement : l'univers se choisit AVANT tout le reste, et une seule
   fois. Ensuite seulement on tente de reprendre la session sauvegardee. */
function demarrerApplication() {
  if (window.ParcoursTheme && !window.ParcoursTheme.aChoisi()) {
    window.ParcoursTheme.ouvrir({ apresChoix: demarrerApplication });
    return;
  }
  /* Espace enseignant : entree separee via l'ancre #enseignant (lien discret
     sur l'ecran de connexion). Il prend la main sur tout le flux eleve. */
  if (window.ParcoursEnseignant && window.ParcoursEnseignant.demandeParURL()) {
    window.ParcoursEnseignant.ouvrir();
    return;
  }
  /* Espace parent : entree separee via l'ancre #parent (lien discret sur
     l'ecran d'accueil). Lecture seule du suivi d'un enfant. */
  if (window.ParcoursParent && window.ParcoursParent.demandeParURL()) {
    window.ParcoursParent.ouvrir();
    return;
  }
  /* Connexion ensuite : rejoindre sa classe (compte eleve) ou essai libre.
     Tant que le choix n'est pas fait, l'ecran de connexion reste devant. */
  if (window.ParcoursCompte && !window.ParcoursCompte.aDecide()) {
    window.ParcoursCompte.demarrerConnexion(demarrerApplication);
    return;
  }
  /* Eleve connecte a une classe : on saute le choix du niveau scolaire. Son
     niveau est celui de sa classe (fige en base), on va droit aux lecons. Le
     mode essai libre, lui, garde le libre choix du niveau (branche ci-dessous). */
  const niveauEleve = niveauImposeEleve();
  if (niveauEleve) {
    demarrerFluxEleve(niveauEleve);
    return;
  }
  /* Ecran de depart d'abord : la reprise est asynchrone et peut echouer, il
     ne doit jamais rester une page vide derriere l'ecran de theme ferme. */
  showStartScreen();
  tryResumeSession();
}

/* Niveau impose a un eleve connecte (celui de sa classe), ou null en essai
   libre / non connecte : la seule source de verite pour "sauter le choix". */
function niveauImposeEleve() {
  return (window.ParcoursCompte?.estEleve?.() && window.ParcoursCompte.getNiveau()) || null;
}

/* Entree dans le jeu pour un eleve : on reprend une partie en cours si elle
   existe, sinon on ouvre directement les lecons de son niveau (jamais l'ecran
   de choix CE1-CE6). On affiche l'ecran des lecons pendant le chargement pour
   ne pas laisser apparaitre, meme une fraction de seconde, le choix de niveau. */
async function demarrerFluxEleve(niveau) {
  showLessonScreen();
  lessonStatus.textContent = "Chargement de tes leçons...";
  /* Garde-robe liee au compte : chargee une fois a la connexion (base), avant
     tout jeu, pour ne jamais montrer celle d'un autre eleve du meme appareil. */
  await window.ParcoursPersonnage?.rechargerPourCompte?.();
  if (await tryResumeSession()) {
    return;
  }
  await rafraichirAssignations();
  try {
    await loadLessons(niveau);
  } catch (error) {
    lessonStatus.textContent = `Impossible de charger les leçons : ${error.message}`;
  }
}

/* Recharge les donnees de compte de l'eleve connecte (travaux assignes ET
   faiblesses reelles pour la revision ciblee) ; vide/inactif en essai libre.
   Best-effort : ne bloque jamais le flux. */
async function rafraichirAssignations() {
  if (niveauImposeEleve()) {
    state.assignations = (await window.ParcoursCompte?.chargerAssignations?.()) || [];
    await window.ParcoursFaiblesses?.rechargerPourEleve?.();
  } else {
    state.assignations = [];
  }
}

demarrerApplication();

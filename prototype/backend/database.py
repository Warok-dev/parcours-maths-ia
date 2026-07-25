"""Fondation de donnees SQLite/SQLAlchemy pour les futurs comptes prof/eleve.

Cette etape pose UNIQUEMENT le schema et son initialisation : aucun endpoint
existant n'est branche dessus. Le fichier de base vit dans backend/data/
(deja ignore par git, comme les sessions), et les tables sont creees au
demarrage du serveur via create_all (pas de migrations pour l'instant).

Modeles : Ecole -> Enseignant -> Classe -> Eleve, plus Progression (maitrise
par concept, une ligne par (eleve, pattern)) et SessionJeu (une session de jeu,
liee a un eleve ou anonyme). Cles etrangeres avec ON DELETE CASCADE la ou c'est
logique (supprimer une classe supprime ses eleves et leurs progressions) et
ON DELETE SET NULL pour les sessions (elles survivent en anonymes).
"""

from __future__ import annotations

import random
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    event,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)
from sqlalchemy.pool import StaticPool

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "parcours.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

NIVEAUX_SCOLAIRES = ("CE1", "CE2", "CE3", "CE4", "CE5", "CE6")

# Animaux pour les codes de classe lisibles par les enfants (ex. CE1-RENARD-42).
_ANIMAUX_CODE = (
    "RENARD", "HIBOU", "OURS", "LOUP", "CERF", "LYNX", "AIGLE", "CASTOR",
    "BLAIREAU", "LOUTRE", "HERISSON", "ECUREUIL", "FAUCON", "MARMOTTE",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generer_code_classe(niveau_scolaire: str) -> str:
    """Code de classe aleatoire, ex. 'CE1-RENARD-42'.

    L'unicite est garantie par la contrainte SQL sur la colonne ; l'appelant
    (futur endpoint) retentera en cas de collision, rare vu l'espace.
    """
    animal = random.choice(_ANIMAUX_CODE)
    return f"{niveau_scolaire}-{animal}-{random.randint(10, 99)}"


class Base(DeclarativeBase):
    pass


class Ecole(Base):
    """Etablissement (prepare le multi-tenant, un seul enregistrement pour l'instant)."""

    __tablename__ = "ecole"

    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    enseignants: Mapped[list["Enseignant"]] = relationship(
        back_populates="ecole", cascade="all, delete-orphan", passive_deletes=True
    )


class Enseignant(Base):
    __tablename__ = "enseignant"

    id: Mapped[int] = mapped_column(primary_key=True)
    ecole_id: Mapped[int] = mapped_column(
        ForeignKey("ecole.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    # Recherche frequente a la connexion -> unique + index.
    identifiant: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    mot_de_passe_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    ecole: Mapped["Ecole"] = relationship(back_populates="enseignants")
    classes: Mapped[list["Classe"]] = relationship(
        back_populates="enseignant", cascade="all, delete-orphan", passive_deletes=True
    )


class Classe(Base):
    __tablename__ = "classe"

    id: Mapped[int] = mapped_column(primary_key=True)
    enseignant_id: Mapped[int] = mapped_column(
        ForeignKey("enseignant.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    niveau_scolaire: Mapped[str] = mapped_column(String(8), nullable=False)
    # Code partage aux eleves pour rejoindre la classe -> unique + index.
    code_classe: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    enseignant: Mapped["Enseignant"] = relationship(back_populates="classes")
    eleves: Mapped[list["Eleve"]] = relationship(
        back_populates="classe", cascade="all, delete-orphan", passive_deletes=True
    )


class Eleve(Base):
    """Eleve : pas d'email, mais un PIN a 4 chiffres pour eviter l'usurpation.

    Le PIN est hache (bcrypt, comme le mot de passe enseignant) : jamais stocke
    en clair. Il est genere a la creation de l'eleve et communique UNE seule
    fois a l'enseignant. Colonne nullable car les eleves crees avant l'ajout du
    PIN n'en ont pas (ils devront etre recrees pour pouvoir se connecter).
    """

    __tablename__ = "eleve"

    id: Mapped[int] = mapped_column(primary_key=True)
    classe_id: Mapped[int] = mapped_column(
        ForeignKey("classe.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prenom: Mapped[str] = mapped_column(String(80), nullable=False)
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    classe: Mapped["Classe"] = relationship(back_populates="eleves")
    progressions: Mapped[list["Progression"]] = relationship(
        back_populates="eleve", cascade="all, delete-orphan", passive_deletes=True
    )
    # Les sessions survivent a la suppression de l'eleve (deviennent anonymes) :
    # pas de delete-orphan, la BD applique ON DELETE SET NULL.
    sessions: Mapped[list["SessionJeu"]] = relationship(
        back_populates="eleve", passive_deletes=True
    )


class Progression(Base):
    """Maitrise atteinte par un eleve sur un concept.

    Une seule ligne par (eleve, pattern) : mise a jour (pas dupliquee) quand
    l'eleve retravaille le concept, en gardant la meilleure maitrise (logique
    appliquee par le futur service, comme le carnet localStorage actuel).
    """

    __tablename__ = "progression"
    __table_args__ = (
        UniqueConstraint("eleve_id", "pattern_name", name="uq_progression_eleve_pattern"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    eleve_id: Mapped[int] = mapped_column(
        ForeignKey("eleve.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pattern_name: Mapped[str] = mapped_column(String(80), nullable=False)
    lecon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    maitrise: Mapped[int] = mapped_column(Integer, nullable=False)
    date_derniere_tentative: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    eleve: Mapped["Eleve"] = relationship(back_populates="progressions")


class SessionJeu(Base):
    """Une session de jeu jouee, liee a un eleve OU anonyme (eleve_id nul, mode essai libre)."""

    __tablename__ = "session_jeu"

    id: Mapped[int] = mapped_column(primary_key=True)
    eleve_id: Mapped[int | None] = mapped_column(
        ForeignKey("eleve.id", ondelete="SET NULL"), nullable=True, index=True
    )
    niveau_scolaire: Mapped[str] = mapped_column(String(8), nullable=False)
    lecon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    date_debut: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    date_derniere_activite: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    termine: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    eleve: Mapped["Eleve | None"] = relationship(back_populates="sessions")


def _enable_sqlite_foreign_keys(engine: Engine) -> None:
    """SQLite n'applique pas les cles etrangeres par defaut : on active le
    PRAGMA a chaque connexion, sinon ON DELETE CASCADE / SET NULL seraient
    ignores."""

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_db_engine(url: str = DATABASE_URL, echo: bool = False) -> Engine:
    """Cree un engine. Pour SQLite en memoire (tests), un StaticPool garde une
    seule connexion afin que la base persiste entre les sessions du test."""
    if url in ("sqlite://", "sqlite:///:memory:"):
        engine = create_engine(
            url, echo=echo, connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    elif url.startswith("sqlite"):
        engine = create_engine(url, echo=echo, connect_args={"check_same_thread": False})
    else:
        engine = create_engine(url, echo=echo)
    if url.startswith("sqlite"):
        _enable_sqlite_foreign_keys(engine)
    return engine


# Engine et fabrique de sessions par defaut (fichier reel). La construction de
# l'engine ne cree aucun fichier : c'est init_db() (ou la 1re connexion) qui le fait.
engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def _migrer_colonnes_manquantes(eng: Engine) -> None:
    """Micro-migration sans outil dedie : ajoute les colonnes apparues apres la
    creation initiale de la base (ici pin_hash sur eleve). create_all ne modifie
    pas une table existante, donc une base deja creee resterait sans la colonne.
    Idempotent : on n'ajoute que ce qui manque."""
    inspector = inspect(eng)
    if "eleve" not in inspector.get_table_names():
        return
    colonnes = {c["name"] for c in inspector.get_columns("eleve")}
    if "pin_hash" not in colonnes:
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE eleve ADD COLUMN pin_hash VARCHAR(255)"))


def init_db(target_engine: Engine | None = None) -> Engine:
    """Cree le dossier data/ et les tables manquantes (idempotent)."""
    eng = target_engine or engine
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(eng)
    _migrer_colonnes_manquantes(eng)
    return eng

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

import os
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


def _normaliser_url(url: str) -> str:
    """Corrige le schema des URLs PostgreSQL heritees.

    SQLAlchemy 2.0 exige le prefixe "postgresql://" ; or plusieurs hebergeurs
    (Neon, Render, Heroku) livrent encore l'ancien alias "postgres://" que le
    driver refuse net. On le reecrit de maniere transparente pour que l'URL
    copiee-collee telle quelle depuis leur tableau de bord fonctionne."""
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


# URL de connexion, resolue dans cet ordre :
#   1. DATABASE_URL  -> variable STANDARD des hebergeurs (Render, Neon...) ;
#      c'est elle qu'on renseigne en production pour pointer sur PostgreSQL.
#   2. PARCOURS_DATABASE_URL -> ancien nom, conserve pour ne rien casser
#      (verification manuelle sur une base jetable, scripts existants).
#   3. Repli SQLite local -> aucune des deux n'est definie : on developpe et on
#      teste hors-ligne sur le fichier reel, sans dependre d'une base distante.
DATABASE_URL = _normaliser_url(
    os.environ.get("DATABASE_URL")
    or os.environ.get("PARCOURS_DATABASE_URL")
    or f"sqlite:///{DB_PATH}"
)

NIVEAUX_SCOLAIRES = ("CE1", "CE2", "CE3", "CE4", "CE5", "CE6")

# Roles d'un compte enseignant au sein de son ecole.
ROLE_ADMINISTRATEUR = "administrateur"
ROLE_ENSEIGNANT = "enseignant"
ROLES_ENSEIGNANT = (ROLE_ADMINISTRATEUR, ROLE_ENSEIGNANT)

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
    # Marqueur d'ecole de DEMONSTRATION (bac a sable public cree en un clic).
    # Une ecole REELLE ne porte JAMAIS ce marqueur : il n'est mis que par
    # l'endpoint /demo/creer. C'est lui qui autorise la purge automatique.
    est_demo: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # Date d'expiration, renseignee UNIQUEMENT pour les ecoles de demo (NULL
    # pour une ecole reelle, qui n'expire jamais). Passe cette date, le nettoyage
    # au demarrage purge l'ecole en cascade (comme les vieux fichiers de session).
    expire_le: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
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
    # Role dans l'ecole : "administrateur" (voit toutes les classes de l'ecole
    # et gere les comptes) ou "enseignant" (ses seules classes). Le tout premier
    # compte d'une ecole est administrateur ; les suivants, invites, sont
    # enseignants par defaut. Voir ROLES_ENSEIGNANT.
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="enseignant", server_default="enseignant"
    )
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
    # ecole_id denormalise l'ecole de l'enseignant proprietaire : il vaut
    # toujours enseignant.ecole_id (invariant maintenu a la creation). Le stocker
    # ici rend la frontiere d'ecole explicite et indexable pour tout filtrage
    # "au niveau ecole" (isolation multi-tenant), sans jointure sur enseignant.
    ecole_id: Mapped[int] = mapped_column(
        ForeignKey("ecole.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    niveau_scolaire: Mapped[str] = mapped_column(String(8), nullable=False)
    # Code partage aux eleves pour rejoindre la classe -> unique + index.
    code_classe: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    enseignant: Mapped["Enseignant"] = relationship(back_populates="classes")
    # Relation many-to-one vers l'ecole (denormalisation). Cote enfant seulement :
    # la suppression d'une ecole passe deja par enseignant -> classe (cascade),
    # inutile de la dupliquer ici.
    ecole: Mapped["Ecole"] = relationship("Ecole")
    eleves: Mapped[list["Eleve"]] = relationship(
        back_populates="classe", cascade="all, delete-orphan", passive_deletes=True
    )


class Eleve(Base):
    """Eleve : pas d'email, mais deux secrets haches (jamais stockes en clair).

    - pin_hash : le PIN a 4 chiffres de l'eleve (bcrypt, faible entropie donc
      hash lent ; l'id de l'eleve est deja connu a la connexion).
    - code_parent_hash : le code d'acces parent, a 8 caracteres (haute entropie).
      Il est cherche a partir du seul code sur un endpoint public : on le stocke
      donc en SHA-256 (deterministe, indexable) pour une recherche directe, la
      ou bcrypt (sale) obligerait a iterer sur tous les eleves. Toujours hache,
      jamais en clair.

    Les deux colonnes sont nullable : les eleves crees avant leur ajout n'en ont
    pas (ils devront etre recrees, respectivement pour se connecter / etre suivis).
    """

    __tablename__ = "eleve"

    id: Mapped[int] = mapped_column(primary_key=True)
    classe_id: Mapped[int] = mapped_column(
        ForeignKey("classe.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prenom: Mapped[str] = mapped_column(String(80), nullable=False)
    # Archivage reversible : "retirer de la classe" met archive=True (l'eleve
    # disparait des vues actives mais ses donnees sont conservees, au cas ou
    # l'enseignant se serait trompe). A distinguer de la suppression definitive
    # (effacement reel, irreversible, droit a l'effacement RGPD).
    archive: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Unique + index : recherche directe du parent par son code (via son hash).
    code_parent_hash: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    classe: Mapped["Classe"] = relationship(back_populates="eleves")
    progressions: Mapped[list["Progression"]] = relationship(
        back_populates="eleve", cascade="all, delete-orphan", passive_deletes=True
    )
    # Garde-robe/etoiles cosmetiques, une ligne par eleve (mode connecte). Le
    # mode invite garde son personnage en localStorage cote frontend.
    personnage: Mapped["Personnage | None"] = relationship(
        back_populates="eleve", cascade="all, delete-orphan", passive_deletes=True, uselist=False
    )
    # Les sessions survivent a la suppression de l'eleve (deviennent anonymes) :
    # pas de delete-orphan, la BD applique ON DELETE SET NULL.
    sessions: Mapped[list["SessionJeu"]] = relationship(
        back_populates="eleve", passive_deletes=True
    )
    assignations: Mapped[list["Assignation"]] = relationship(
        back_populates="eleve", cascade="all, delete-orphan", passive_deletes=True
    )


class Progression(Base):
    """Maitrise atteinte par un eleve sur un concept d'une lecon.

    Une seule ligne par (eleve, pattern, lecon) : mise a jour (pas dupliquee)
    quand l'eleve retravaille le concept, en gardant la meilleure maitrise
    (logique appliquee par le futur service, comme le carnet localStorage
    actuel). Un meme pattern present dans deux lecons donne deux lignes.
    """

    __tablename__ = "progression"
    __table_args__ = (
        # Un meme concept (pattern_name) peut vivre dans plusieurs lecons : la
        # lecon fait donc partie de l'identite d'une progression, sinon deux
        # lecons partageant un pattern se confondraient sur une seule ligne.
        # (NB : cote SQL, un lecon_id NULL n'entre pas en conflit avec un autre
        #  NULL ; l'upsert applicatif le gere via une recherche IS NULL.)
        UniqueConstraint(
            "eleve_id", "pattern_name", "lecon_id",
            name="uq_progression_eleve_pattern_lecon",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    eleve_id: Mapped[int] = mapped_column(
        ForeignKey("eleve.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pattern_name: Mapped[str] = mapped_column(String(80), nullable=False)
    lecon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    maitrise: Mapped[int] = mapped_column(Integer, nullable=False)
    # Nombre de fois ou le concept a ete travaille (une session achevee = une
    # tentative). La maitrise ne baisse jamais, donc ce compteur est le seul
    # moyen de distinguer "vu une fois, encore a 1" de "retravaille plusieurs
    # fois sans debloquer" -> sert a l'alerte de blocage parent.
    nb_tentatives: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default="1"
    )
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


class Assignation(Base):
    """Un travail assigne par l'enseignant a UN eleve : soit une lecon complete
    (lecon_id), soit une revision ciblee (patterns = liste de pattern_name en
    JSON). Exactement l'un des deux est renseigne. terminee bascule a true
    automatiquement quand l'eleve termine la session correspondante."""

    __tablename__ = "assignation"

    id: Mapped[int] = mapped_column(primary_key=True)
    eleve_id: Mapped[int] = mapped_column(
        ForeignKey("eleve.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # L'enseignant qui a assigne (garde a titre indicatif ; SET NULL s'il part).
    assignee_par: Mapped[int | None] = mapped_column(
        ForeignKey("enseignant.id", ondelete="SET NULL"), nullable=True
    )
    lecon_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Revision ciblee : liste de pattern_name serialisee en JSON (ou NULL).
    patterns: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    date_assignation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    terminee: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    date_completion: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    eleve: Mapped["Eleve"] = relationship(back_populates="assignations")


class Personnage(Base):
    """Personnage cosmetique d'un eleve connecte : total d'etoiles cumulees et
    tenue choisie (couleur + accessoire). Une seule ligne par eleve. C'est
    l'equivalent en base du localStorage `personnage_v1` du mode invite : ainsi
    un eleve connecte retrouve SA garde-robe, jamais celle d'un camarade ayant
    joue sur le meme appareil. Purement cosmetique (aucun enjeu pedagogique)."""

    __tablename__ = "personnage"

    id: Mapped[int] = mapped_column(primary_key=True)
    eleve_id: Mapped[int] = mapped_column(
        ForeignKey("eleve.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    etoiles_totales: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    couleur: Mapped[str] = mapped_column(String(40), nullable=False, default="bleu", server_default="bleu")
    accessoire: Mapped[str] = mapped_column(
        String(40), nullable=False, default="aucun", server_default="aucun"
    )
    date_maj: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    eleve: Mapped["Eleve"] = relationship(back_populates="personnage")


class InvitationEnseignant(Base):
    """Invitation a rejoindre une ecole comme enseignant simple.

    Un administrateur en genere une : elle porte un code a usage unique (haute
    entropie, comme le code parent) que le nouvel enseignant fournit a
    l'inscription pour etre rattache a l'ecole (au lieu de fonder la sienne).
    N'importe quel identifiant peut consommer le code tant qu'il n'a pas servi.
    Le code est stocke en clair : ce n'est pas un secret d'authentification mais
    un jeton d'enrolement a usage unique, revele par l'admin puis consomme.

    (Aucun email/destinataire n'est stocke : l'ancien champ email_invite, simple
    aide-memoire non necessaire, a ete retire par minimisation des donnees.)"""

    __tablename__ = "invitation_enseignant"

    id: Mapped[int] = mapped_column(primary_key=True)
    ecole_id: Mapped[int] = mapped_column(
        ForeignKey("ecole.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    # L'admin qui a emis l'invitation (indicatif ; SET NULL s'il part).
    invitee_par: Mapped[int | None] = mapped_column(
        ForeignKey("enseignant.id", ondelete="SET NULL"), nullable=True
    )
    utilisee: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    date_creation: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    date_utilisation: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    ecole: Mapped["Ecole"] = relationship()


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
        # PostgreSQL (Neon) & co. : pool_pre_ping teste la connexion avant de la
        # servir. Neon ferme les connexions restees inactives (et le service
        # Render peut s'endormir) ; sans ce ping, la 1re requete apres une pause
        # ramasserait une connexion morte -> erreur 500. pool_recycle force en
        # plus le renouvellement des connexions vieilles de 5 min.
        engine = create_engine(url, echo=echo, pool_pre_ping=True, pool_recycle=300)
    if url.startswith("sqlite"):
        _enable_sqlite_foreign_keys(engine)
    return engine


# Engine et fabrique de sessions par defaut (fichier reel). La construction de
# l'engine ne cree aucun fichier : c'est init_db() (ou la 1re connexion) qui le fait.
engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def _migrer_unicite_progression(eng: Engine, inspector) -> None:
    """Fait passer l'unicite de progression de (eleve, pattern) a
    (eleve, pattern, lecon).

    Sans ca, un meme concept present dans deux lecons se confondait sur une
    seule ligne. Idempotent : si une contrainte unique porte deja lecon_id, on
    ne fait rien (bases neuves creees par create_all avec le modele a jour).

    - SQLite ne sait pas modifier une contrainte : on reconstruit la table
      (recette officielle create/copy/drop/rename), sans risque d'orphelin car
      aucune autre table ne reference progression.
    - PostgreSQL : DROP puis ADD CONSTRAINT, l'ancien nom etant lu par reflet.
    """
    uniques = inspector.get_unique_constraints("progression")
    if any("lecon_id" in u["column_names"] for u in uniques):
        return  # deja au bon format

    if eng.dialect.name == "sqlite":
        with eng.begin() as conn:
            conn.execute(
                text(
                    "CREATE TABLE progression_new ("
                    " id INTEGER NOT NULL PRIMARY KEY,"
                    " eleve_id INTEGER NOT NULL,"
                    " pattern_name VARCHAR(80) NOT NULL,"
                    " lecon_id VARCHAR(80),"
                    " maitrise INTEGER NOT NULL,"
                    " nb_tentatives INTEGER NOT NULL DEFAULT 1,"
                    " date_derniere_tentative DATETIME NOT NULL,"
                    " CONSTRAINT uq_progression_eleve_pattern_lecon"
                    "  UNIQUE (eleve_id, pattern_name, lecon_id),"
                    " FOREIGN KEY(eleve_id) REFERENCES eleve (id) ON DELETE CASCADE"
                    ")"
                )
            )
            conn.execute(
                text(
                    "INSERT INTO progression_new"
                    " (id, eleve_id, pattern_name, lecon_id, maitrise,"
                    "  nb_tentatives, date_derniere_tentative)"
                    " SELECT id, eleve_id, pattern_name, lecon_id, maitrise,"
                    "  nb_tentatives, date_derniere_tentative FROM progression"
                )
            )
            conn.execute(text("DROP TABLE progression"))
            conn.execute(text("ALTER TABLE progression_new RENAME TO progression"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_progression_eleve_id"
                    " ON progression (eleve_id)"
                )
            )
    else:
        ancienne = next(
            (
                u["name"]
                for u in uniques
                if set(u["column_names"]) == {"eleve_id", "pattern_name"} and u["name"]
            ),
            None,
        )
        with eng.begin() as conn:
            if ancienne:
                conn.execute(
                    text(f'ALTER TABLE progression DROP CONSTRAINT "{ancienne}"')
                )
            conn.execute(
                text(
                    "ALTER TABLE progression ADD CONSTRAINT"
                    " uq_progression_eleve_pattern_lecon"
                    " UNIQUE (eleve_id, pattern_name, lecon_id)"
                )
            )


def _migrer_colonnes_manquantes(eng: Engine) -> None:
    """Micro-migration sans outil dedie : ajoute les colonnes apparues apres la
    creation initiale de la base (ici pin_hash sur eleve). create_all ne modifie
    pas une table existante, donc une base deja creee resterait sans la colonne.
    Idempotent : on n'ajoute que ce qui manque.

    Note PostgreSQL : ces ALTER ecrivent du SQL a la main pense pour SQLite (les
    bases locales deja creees). Sur une base PostgreSQL NEUVE (Neon), create_all
    cree d'emblee toutes les colonnes : aucun de ces blocs ne se declenche donc,
    ils sont sans effet la-bas. Il n'y a pas de base PostgreSQL preexistante a
    rattraper, donc pas de migration a rejouer -> compatibilite assuree."""
    inspector = inspect(eng)
    tables = set(inspector.get_table_names())
    if "ecole" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("ecole")}
        if "est_demo" not in colonnes:
            # Colonne avec defaut : SQLite l'accepte sur une table peuplee. Les
            # ecoles existantes sont REELLES (est_demo=0), jamais des demos.
            with eng.begin() as conn:
                conn.execute(
                    text("ALTER TABLE ecole ADD COLUMN est_demo BOOLEAN NOT NULL DEFAULT 0")
                )
        if "expire_le" not in colonnes:
            # Nullable, sans defaut : les ecoles reelles restent sans expiration.
            with eng.begin() as conn:
                conn.execute(text("ALTER TABLE ecole ADD COLUMN expire_le DATETIME"))
    if "eleve" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("eleve")}
        if "pin_hash" not in colonnes:
            with eng.begin() as conn:
                conn.execute(text("ALTER TABLE eleve ADD COLUMN pin_hash VARCHAR(255)"))
        if "code_parent_hash" not in colonnes:
            with eng.begin() as conn:
                conn.execute(text("ALTER TABLE eleve ADD COLUMN code_parent_hash VARCHAR(64)"))
                # Index unique sur la nouvelle colonne (recherche du parent par code).
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_eleve_code_parent_hash "
                        "ON eleve (code_parent_hash)"
                    )
                )
        if "archive" not in colonnes:
            # Colonne avec defaut : les eleves existants sont actifs (archive=0).
            with eng.begin() as conn:
                conn.execute(
                    text("ALTER TABLE eleve ADD COLUMN archive BOOLEAN NOT NULL DEFAULT 0")
                )
    if "classe" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("classe")}
        if "ecole_id" not in colonnes:
            # SQLite refuse d'ajouter une colonne NOT NULL sans defaut sur une
            # table peuplee : on ajoute la colonne nullable, on la remplit depuis
            # l'ecole de l'enseignant proprietaire (invariant ecole_id ==
            # enseignant.ecole_id), puis on l'indexe.
            with eng.begin() as conn:
                conn.execute(text("ALTER TABLE classe ADD COLUMN ecole_id INTEGER"))
                conn.execute(
                    text(
                        "UPDATE classe SET ecole_id = ("
                        "SELECT e.ecole_id FROM enseignant e WHERE e.id = classe.enseignant_id"
                        ") WHERE ecole_id IS NULL"
                    )
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_classe_ecole_id ON classe (ecole_id)")
                )
    if "enseignant" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("enseignant")}
        if "role" not in colonnes:
            # Colonne avec defaut : SQLite l'accepte sur une table peuplee. On
            # promeut ensuite le compte le plus ancien de CHAQUE ecole en
            # administrateur, pour qu'aucune ecole preexistante ne se retrouve
            # sans administrateur (invariant : >= 1 admin par ecole).
            with eng.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE enseignant "
                        "ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'enseignant'"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE enseignant SET role = 'administrateur' WHERE id IN ("
                        "  SELECT (SELECT e2.id FROM enseignant e2 "
                        "          WHERE e2.ecole_id = grp.ecole_id "
                        "          ORDER BY e2.date_creation ASC, e2.id ASC LIMIT 1) "
                        "  FROM (SELECT DISTINCT ecole_id FROM enseignant) grp"
                        ")"
                    )
                )
    if "progression" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("progression")}
        if "nb_tentatives" not in colonnes:
            # Les lignes existantes prennent 1 (au moins une tentative pour exister).
            with eng.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE progression "
                        "ADD COLUMN nb_tentatives INTEGER NOT NULL DEFAULT 1"
                    )
                )
        _migrer_unicite_progression(eng, inspector)
    if "invitation_enseignant" in tables:
        colonnes = {c["name"] for c in inspector.get_columns("invitation_enseignant")}
        if "email_invite" in colonnes:
            # Minimisation des donnees : l'ancien aide-memoire email_invite est
            # retire. DROP COLUMN est supporte par PostgreSQL et par SQLite
            # >= 3.35 (le sqlite3 embarque de Python 3.13 est bien au-dela).
            with eng.begin() as conn:
                conn.execute(
                    text("ALTER TABLE invitation_enseignant DROP COLUMN email_invite")
                )


def init_db(target_engine: Engine | None = None) -> Engine:
    """Cree le dossier data/ et les tables manquantes (idempotent)."""
    eng = target_engine or engine
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(eng)
    _migrer_colonnes_manquantes(eng)
    return eng

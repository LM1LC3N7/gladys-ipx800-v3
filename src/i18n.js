// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// refusals of a command), in English and French.
// -----------------------------------------------------------------------------

import { FEATURES as F, KINDS } from './constants.js';

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

export const both = (en, fr) => ({ en, fr });

/** Several messages one after the other, in each language. */
export const join = (...messages) => {
  const parts = messages.filter(Boolean);
  return both(parts.map((m) => m.en).join(' '), parts.map((m) => m.fr).join(' '));
};

/** "45 s" / "25 min" / "3 h", for the waits. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** Lists the first 5 entries, then "and N more". */
export function listOf(entries) {
  const shown = entries.slice(0, 5);
  const more = entries.length - shown.length;
  return both(
    shown.join(', ') + (more > 0 ? ` and ${more} more` : ''),
    shown.join(', ') + (more > 0 ? ` et ${more} autre(s)` : ''),
  );
}

/** A value as the user reads it. */
export function describe(kind, value) {
  if (value === undefined) return both('unknown', 'inconnu');
  return value === 1 ? both('on', 'allumé') : both('off', 'éteint');
}

export const FEATURE_NAMES = {
  // Right in both states: a relay listed later keeps this feature next to its switch, under
  // the name it was created with (Gladys never renames it, and it cannot be deleted alone).
  // What to do lives in the status and the guide.
  [F.READONLY]: both('State (read only)', 'État (lecture seule)'),
  [F.SWITCH]: both('Switch', 'Interrupteur'),
  [F.LIGHT]: both('Light', 'Lumière'),
  [F.STATE]: both('State', 'État'),
  [F.TEMPERATURE]: both('Temperature', 'Température'),
  [F.HUMIDITY]: both('Humidity', 'Humidité'),
};

/** The code as the user types it: `R3`, `D5`, `A1`. */
export const shownCode = (code) => code.toUpperCase();

/** The name of a target in Gladys: "Relay 3 (R3)", "Input 5 (D5)", "Analog input 1 (A1)". */
export function targetName(target) {
  const code = shownCode(target.code);
  switch (target.kind) {
    case KINDS.RELAY:
      return both(`Relay ${target.n} (${code})`, `Relais ${target.n} (${code})`);
    case KINDS.INPUT:
      return both(`Input ${target.n} (${code})`, `Entrée ${target.n} (${code})`);
    default:
      return both(`Analog input ${target.n} (${code})`, `Entrée analogique ${target.n} (${code})`);
  }
}

/** "IPX800 #2 · Relay 3 (R3)" for the IPX800 n >= 2 of the configuration; the name alone for the first. */
export const slotName = (slot, name) =>
  slot === 1 ? name : both(`IPX800 #${slot} · ${name.en}`, `IPX800 n°${slot} · ${name.fr}`);

/** The reason of a failure, in each language. */
export function reasonOf(err) {
  const status = err?.status ? ` (HTTP ${err.status})` : '';
  switch (err?.code) {
    case 'network':
      return both(`no connection (${err.message})`, `pas de connexion (${err.message})`);
    case 'timeout':
      return both('no answer in time', 'pas de réponse à temps');
    case 'late':
      return both('no time left to send', 'plus le temps d’envoyer');
    case 'cut':
      return both('interrupted', 'interrompue');
    case 'refused':
      return both(
        `user or password refused${status}`,
        `utilisateur ou mot de passe refusé${status}`,
      );
    case 'busy':
      return both(`the IPX800 asks to wait${status}`, `l’IPX800 demande d’attendre${status}`);
    case 'http':
      return err?.status === 404
        ? both(
            'no status page (HTTP 404): is it an IPX800 V3?',
            'pas de page d’état (HTTP 404) : est-ce bien un IPX800 V3 ?',
          )
        : both(`unexpected answer${status}`, `réponse inattendue${status}`);
    case 'size':
      return both('answer too large', 'réponse trop grande');
    case 'not_success':
      return both('the IPX800 answered an error', 'l’IPX800 a répondu une erreur');
    case 'bad_response':
      return both('not an IPX800 V3 answer', 'pas une réponse d’IPX800 V3');
    default:
      return both('internal error', 'erreur interne');
  }
}

export const T = {
  noConfig: both('Enter the address of the IPX800 V3.', 'Saisissez l’adresse de l’IPX800 V3.'),
  addressPath: both(
    'The address must be an IP address or a name, without path nor password (e.g. 192.168.1.50).',
    'L’adresse doit être une adresse IP ou un nom, sans chemin ni mot de passe (par ex. 192.168.1.50).',
  ),
  addressHttps: both(
    'The IPX800 V3 is reached over http on your network: remove "https://".',
    'L’IPX800 V3 se joint en http sur votre réseau : retirez « https:// ».',
  ),
  addressInvalid: both('The address is not valid.', 'L’adresse n’est pas valide.'),
  credentials: {
    user: both(
      'The user is not valid (letters, digits and symbols, no space nor ":", 64 characters at most).',
      'L’utilisateur n’est pas valide (lettres, chiffres et symboles, sans espace ni « : », 64 caractères au plus).',
    ),
    password: both(
      'The password is not valid (letters, digits, symbols and spaces, 64 characters at most).',
      'Le mot de passe n’est pas valide (lettres, chiffres, symboles et espaces, 64 caractères au plus).',
    ),
    passwordAlone: both(
      'A password without a user: enter the user too (or neither, when the IPX800 does not protect its pages).',
      'Un mot de passe sans utilisateur : saisissez aussi l’utilisateur (ou aucun des deux si l’IPX800 ne protège pas ses pages).',
    ),
    userAlone: both(
      'A user without a password: enter the password too (or neither, when the IPX800 does not protect its pages).',
      'Un utilisateur sans mot de passe : saisissez aussi le mot de passe (ou aucun des deux si l’IPX800 ne protège pas ses pages).',
    ),
  },
  connecting: both('Connecting to the IPX800 V3…', 'Connexion à l’IPX800 V3…'),
  configNotRead: (wait) =>
    both(
      `The configuration could not be read from Gladys: new try in ${wait.en}.`,
      `La configuration n’a pas pu être lue dans Gladys : nouvel essai dans ${wait.fr}.`,
    ),
  connected: (counts) => {
    const parts = (lang) =>
      [
        [counts.relays, 'relay(s)', 'relais'],
        [counts.inputs, 'input(s)', 'entrée(s)'],
        [counts.analogs, 'analog sensor(s)', 'capteur(s) analogique(s)'],
      ]
        .filter(([n]) => n > 0)
        .map(([n, en, fr]) => `${n} ${lang === 'en' ? en : fr}`)
        .join(', ');
    return both(
      `Connected to the IPX800 V3: ${parts('en') || 'nothing found'}.`,
      `Connecté à l’IPX800 V3 : ${parts('fr') || 'rien trouvé'}.`,
    );
  },
  unreachable: (reason, wait) =>
    both(
      `The IPX800 V3 does not answer (${reason.en}): new try in ${wait.en}.`,
      `L’IPX800 V3 ne répond pas (${reason.fr}) : nouvel essai dans ${wait.fr}.`,
    ),
  refused: both(
    'The IPX800 V3 refused the user or the password (or asks for them): no read until they change or "Test the connection" succeeds.',
    'L’IPX800 V3 a refusé l’utilisateur ou le mot de passe (ou les demande) : plus de lecture tant qu’ils ne changent pas ou que « Tester la connexion » n’aboutit pas.',
  ),
  relayErrors: (list) =>
    both(`Relays not understood: ${list.en}.`, `Relais non compris : ${list.fr}.`),
  extensionErrors: (list) =>
    both(`Extensions not understood: ${list.en}.`, `Extensions non comprises : ${list.fr}.`),
  relaysReadOnly: (count) =>
    count === 1
      ? both(
          '1 relay read only: list it in Configuration → Relays Gladys may drive only if Gladys must drive it (never a pump, a ventilation, a door strike…).',
          '1 relais en lecture seule : listez-le dans Configuration → Relais pilotables par Gladys seulement si Gladys doit le piloter (jamais une pompe, une VMC, une gâche…).',
        )
      : both(
          `${count} relays read only: list in Configuration → Relays Gladys may drive those Gladys must drive (never a pump, a ventilation, a door strike…).`,
          `${count} relais en lecture seule : listez dans Configuration → Relais pilotables par Gladys ceux que Gladys doit piloter (jamais une pompe, une VMC, une gâche…).`,
        ),
  relaysToUpdate: (list) =>
    both(
      `Relays listed, waiting for "Update" in Discover to be driven: ${list.en}.`,
      `Relais listés, en attente de « Mettre à jour » dans Découverte pour être pilotés : ${list.fr}.`,
    ),
  analogsUnpublished: (list) =>
    both(
      `Analog inputs with a sensor type not handled yet (not published): ${list.en}.`,
      `Entrées analogiques d’un type de capteur pas encore pris en charge (non publiées) : ${list.fr}.`,
    ),
  relaysMissing: (list) =>
    both(
      `Relays declared but not found on the IPX800 V3: ${list.en}.`,
      `Relais déclarés mais absents de l’IPX800 V3 : ${list.fr}.`,
    ),
  guardsPending: (list) =>
    both(
      `Switch-off not applied yet, sent again: ${list.en}.`,
      `Extinction pas encore appliquée, renvoyée : ${list.fr}.`,
    ),
  guardsFailed: (list) =>
    both(
      `Switch-off not applied after 3 tries, check on site: ${list.en}.`,
      `Extinction non appliquée après 3 essais, vérifiez sur place : ${list.fr}.`,
    ),
  notApplied: (list) =>
    both(
      `Last command not applied (read back differs): ${list.en}.`,
      `Dernière commande non appliquée (la relecture diffère) : ${list.fr}.`,
    ),
  pendingDropped: (list) =>
    both(
      `Switch-off clicked before the configuration was read, not sent (relay not listed or unknown): ${list.en}.`,
      `Extinction cliquée avant la lecture de la configuration, non envoyée (relais non listé ou inconnu) : ${list.fr}.`,
    ),
  storeProblem: both(
    'The state cannot be written to /data: a restart would forget the switch-offs to send again.',
    'L’état ne peut pas être écrit dans /data : un redémarrage oublierait les extinctions à renvoyer.',
  ),
  otherIpx: (slot) =>
    both(
      `The IPX800 V3 at this address (or port) is not the one the devices of IPX800 #${slot} were created for: none of their commands is sent, and their switch-offs kept are dropped. Put back the address of their IPX800 (another IPX800 goes in its own slot, see the guide), or, if it is the same IPX800 at a new address, click "Attach the devices" twice.`,
      `L’IPX800 V3 à cette adresse (ou ce port) n’est pas celui pour lequel les appareils de l’IPX800 n°${slot} ont été créés : aucune de leurs commandes n’est envoyée, et leurs extinctions gardées sont abandonnées. Remettez l’adresse de leur IPX800 (un autre IPX800 va dans son propre emplacement, voir le guide), ou, si c’est le même IPX800 à une nouvelle adresse, cliquez deux fois « Rattacher les appareils ».`,
    ),
  notAttached: (slot) =>
    both(
      `The devices of IPX800 #${slot} are not known to belong to the IPX800 read (the state in /data was lost): none of their commands is sent. If they are its own, click "Attach the devices" twice.`,
      `Rien ne dit que les appareils de l’IPX800 n°${slot} appartiennent à l’IPX800 lu (l’état de /data a été perdu) : aucune de leurs commandes n’est envoyée. Si ce sont les siens, cliquez deux fois « Rattacher les appareils ».`,
    ),
  ownerUnreadable: both(
    'The state in /data cannot be read: which IPX800 the devices belong to is unknown, only switch-offs are sent until it can.',
    'L’état de /data ne peut pas être lu : on ne sait pas à quel IPX800 appartiennent les appareils, seules les extinctions sont envoyées d’ici là.',
  ),
  attach: {
    notRead: both(
      'No IPX800 read right now: click "Test the connection" first.',
      'Aucun IPX800 lu en ce moment : cliquez d’abord « Tester la connexion ».',
    ),
    already: (slot) =>
      both(
        `The devices of IPX800 #${slot} already belong to the IPX800 read: nothing to do.`,
        `Les appareils de l’IPX800 n°${slot} appartiennent déjà à l’IPX800 lu : rien à faire.`,
      ),
    confirm: (slot, count) =>
      both(
        `Click again within a minute to attach the ${count} device(s) of IPX800 #${slot} to the IPX800 V3 read now at this address: its relays listed in the configuration will obey them.`,
        `Cliquez à nouveau dans la minute pour rattacher les ${count} appareil(s) de l’IPX800 n°${slot} à l’IPX800 V3 lu en ce moment à cette adresse : ses relais listés dans la configuration leur obéiront.`,
      ),
    done: (slot, count) =>
      both(
        `Done: the ${count} device(s) of IPX800 #${slot} belong to the IPX800 read.`,
        `C’est fait : les ${count} appareil(s) de l’IPX800 n°${slot} appartiennent à l’IPX800 lu.`,
      ),
    noSlot: both(
      'Choose an IPX800 of the configuration.',
      'Choisissez un IPX800 de la configuration.',
    ),
  },
  test: {
    busy: both(
      'A read is already running: try again in a moment.',
      'Une lecture est déjà en cours : réessayez dans un instant.',
    ),
    wait: (wait) =>
      both(
        `The IPX800 was read less than an interval ago: next read in ${wait.en}.`,
        `L’IPX800 a été lu il y a moins d’un intervalle : prochaine lecture dans ${wait.fr}.`,
      ),
    slow: both(
      'The IPX800 is slow to answer: see the status in a moment.',
      'L’IPX800 tarde à répondre : voyez l’état dans un instant.',
    ),
  },
};

/** The refusals of a command (the message of the error Gladys shows). */
export const ERRORS = {
  readOnly: both(
    'This relay is read only: add it to "Relays Gladys may drive" to drive it. Nothing was sent.',
    'Ce relais est en lecture seule : ajoutez-le à « Relais pilotables par Gladys » pour le piloter. Rien n’a été envoyé.',
  ),
  notCommandable: both(
    'This feature is read only: nothing was sent.',
    'Cette fonctionnalité est en lecture seule : rien n’a été envoyé.',
  ),
  badValue: both(
    'This value is not valid: nothing was sent.',
    'Cette valeur n’est pas valide : rien n’a été envoyé.',
  ),
  configNotLoaded: both(
    'The configuration is not read yet: nothing was sent.',
    'La configuration n’est pas encore lue : rien n’a été envoyé.',
  ),
  noConfig: both(
    'The address of the IPX800 is missing or not valid: nothing was sent.',
    'L’adresse de l’IPX800 manque ou n’est pas valide : rien n’a été envoyé.',
  ),
  unknownTarget: both(
    'This output is not known on the IPX800 (yet): nothing was sent.',
    'Cette sortie n’est pas (encore) connue sur l’IPX800 : rien n’a été envoyé.',
  ),
  paused: (reason) =>
    both(
      `The IPX800 does not answer (${reason.en}): nothing was sent.`,
      `L’IPX800 ne répond pas (${reason.fr}) : rien n’a été envoyé.`,
    ),
  keyRefused: both(
    'The IPX800 refused the user or the password: nothing was sent.',
    'L’IPX800 a refusé l’utilisateur ou le mot de passe : rien n’a été envoyé.',
  ),
  stopPending: both(
    'A switch-off is being sent to this relay: nothing was sent.',
    'Une extinction est en cours d’envoi sur ce relais : rien n’a été envoyé.',
  ),
  cancelledByStop: both(
    'Cancelled by a later switch-off: nothing was sent.',
    'Annulée par une extinction plus récente : rien n’a été envoyé.',
  ),
  queueFull: both(
    'Too many commands waiting: nothing was sent.',
    'Trop de commandes en attente : rien n’a été envoyé.',
  ),
  late: (ahead) =>
    ahead > 0
      ? both(
          `The IPX800 was too slow (${ahead} command(s) before this one): nothing was sent.`,
          `L’IPX800 a été trop lent (${ahead} commande(s) avant celle-ci) : rien n’a été envoyé.`,
        )
      : both(
          'The IPX800 was too slow: nothing was sent.',
          'L’IPX800 a été trop lent : rien n’a été envoyé.',
        ),
  notSent: (reason) =>
    both(
      `Not sent (${reason.en}): nothing was sent.`,
      `Non envoyée (${reason.fr}) : rien n’a été envoyé.`,
    ),
  cut: both(
    'Interrupted by a switch-off: nothing was sent.',
    'Interrompue par une extinction : rien n’a été envoyé.',
  ),
  unconfirmed: both(
    'Sent, without confirmation: the IPX800 is read again in a few seconds.',
    'Envoyée, sans confirmation : l’IPX800 est relu dans quelques secondes.',
  ),
  rejected: both(
    'Sent, but the IPX800 answered an error: it is read again in a few seconds.',
    'Envoyée, mais l’IPX800 a répondu une erreur : il est relu dans quelques secondes.',
  ),
  notApplied: (read, wanted) =>
    both(
      `Sent, but the IPX800 reads ${read.en} (asked: ${wanted.en}): not applied yet, read again in a few seconds.`,
      `Envoyée, mais l’IPX800 lit ${read.fr} (demandé : ${wanted.fr}) : pas encore appliquée, relue dans quelques secondes.`,
    ),
  otherIpx: (slot) =>
    both(
      `The IPX800 at this address is not the one this device was created for (IPX800 #${slot}): nothing was sent.`,
      `L’IPX800 à cette adresse n’est pas celui pour lequel cet appareil a été créé (IPX800 n°${slot}) : rien n’a été envoyé.`,
    ),
  notAttached: (slot) =>
    both(
      `It is not known that this device belongs to the IPX800 read (IPX800 #${slot}, see its status): nothing was sent.`,
      `Rien ne dit que cet appareil appartient à l’IPX800 lu (IPX800 n°${slot}, voir son état) : rien n’a été envoyé.`,
    ),
  keptUntilConfig: both(
    'Not sent yet: the configuration is being read from Gladys; kept and sent as soon as it is read.',
    'Pas encore envoyée : la configuration est en cours de lecture dans Gladys ; gardée et envoyée dès sa lecture.',
  ),
  protectiveKept: (reason) =>
    both(
      `Not sent yet (${reason.en}): kept and sent again as soon as the IPX800 is free.`,
      `Pas encore envoyée (${reason.fr}) : gardée et renvoyée dès que l’IPX800 est libre.`,
    ),
};

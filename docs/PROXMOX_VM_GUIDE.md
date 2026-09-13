# Installer HarnessHub sur une VM Proxmox vide

Ce tutoriel part d’un serveur Proxmox fonctionnel et aboutit à un premier projet piloté depuis Discord. Il utilise une VM Debian 12 dédiée à HarnessHub.

À la fin, tu auras :

- une VM Linux isolée et démarrée automatiquement ;
- HarnessHub exécuté par un compte système non-root ;
- un bot Discord connecté à un unique serveur ;
- Pi installé et authentifié nativement ;
- un salon Discord capable de lancer une tâche de développement.

## 1. Télécharger Debian

Télécharge l’image **Debian 12 netinst amd64** depuis [debian.org](https://www.debian.org/distrib/netinst), puis ajoute-la au stockage ISO de Proxmox :

1. ouvre l’interface Proxmox ;
2. sélectionne le stockage `local` ;
3. ouvre **ISO Images** ;
4. clique sur **Upload** ;
5. téléverse l’ISO Debian.

## 2. Créer la VM Proxmox

Clique sur **Create VM** et utilise cette configuration :

| Écran   | Valeur recommandée                                                                |
| ------- | --------------------------------------------------------------------------------- |
| General | nom `harnesshub`                                                                  |
| OS      | ISO Debian 12, type Linux                                                         |
| System  | machine `q35`, contrôleur VirtIO SCSI single, QEMU Guest Agent activé             |
| Disks   | 100 Go, bus SCSI, cache par défaut, discard activé, SSD emulation si stockage SSD |
| CPU     | type `host`, 1 socket, 4 cœurs                                                    |
| Memory  | 8192 Mo, ballooning désactivé                                                     |
| Network | bridge `vmbr0`, modèle VirtIO                                                     |

La configuration minimale raisonnable est 2 vCPU, 4 Go de RAM et 40 Go de disque. Pour de gros builds, utilise 8 vCPU, 16 Go de RAM et au moins 200 Go.

Démarre la VM et ouvre sa console.

## 3. Installer Debian 12

Pendant l’installation Debian :

1. choisis une installation standard sans environnement graphique ;
2. utilise `harnesshub-vm` comme nom d’hôte ;
3. à l’écran du mot de passe `root`, laisse les champs vides : Debian donnera les droits `sudo` au premier utilisateur ;
4. crée ce compte administrateur personnel, par exemple `admin`, avec un mot de passe fort ;
5. sélectionne **SSH server** et **standard system utilities** ;
6. installe GRUB sur le disque principal ;
7. redémarre puis retire l’ISO si Proxmox ne le fait pas automatiquement.

Connecte-toi avec le compte administrateur créé pendant l’installation.

Affiche l’adresse IP :

```bash
ip -brief address
```

Réserve cette adresse dans ton serveur DHCP ou configure une IP fixe adaptée à ton réseau. Depuis ton ordinateur, connecte-toi ensuite en SSH :

```bash
ssh admin@ADRESSE_IP_DE_LA_VM
```

## 4. Mettre Debian à jour

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl gnupg git openssh-client qemu-guest-agent ufw
sudo systemctl enable --now qemu-guest-agent

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable

sudo reboot
```

Attends le redémarrage, puis reconnecte-toi en SSH.

Dans Proxmox, l’adresse IP doit maintenant apparaître dans le résumé de la VM grâce au QEMU Guest Agent.

Vérifie que le pare-feu autorise SSH et que l’horloge est synchronisée :

```bash
sudo ufw status verbose
timedatectl status
```

HarnessHub ne nécessite aucun port entrant. La VM doit seulement pouvoir effectuer des connexions HTTPS sortantes vers Discord, GitHub, npm et le fournisseur choisi, ainsi que résoudre les noms DNS.

## 5. Installer Node.js 22 au niveau système

HarnessHub nécessite Node.js 22.5 à 24. Une installation `nvm` ne convient pas au service systemd.

Ajoute le dépôt signé NodeSource sans exécuter de script distant en root :

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /tmp/nodesource-repo.gpg.key
sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource-repo.gpg.key
rm -f /tmp/nodesource-repo.gpg.key
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update
sudo apt install -y nodejs
```

Vérifie les prérequis :

```bash
node --version
npm --version
git --version
systemctl --version
```

`node --version` doit afficher au minimum `v22.5.0` et rester inférieur à `v25.0.0`.

## 6. Créer le bot Discord

Ouvre le [Discord Developer Portal](https://discord.com/developers/applications).

### Créer l’application et récupérer le token

1. clique sur **New Application** ;
2. nomme-la `HarnessHub` ;
3. ouvre **Bot** ;
4. crée le bot si nécessaire ;
5. active **Message Content Intent** ;
6. utilise **Reset Token**, copie le token et conserve-le temporairement dans un gestionnaire de mots de passe.

Ne publie jamais ce token dans Discord, Git ou une capture d’écran.

### Inviter le bot

1. ouvre **OAuth2 → URL Generator** ;
2. sélectionne les scopes `bot` et `applications.commands` ;
3. accorde uniquement :
   - View Channels ;
   - Send Messages ;
   - Read Message History ;
   - Manage Channels ;
   - Manage Roles ;
4. ouvre l’URL générée ;
5. invite le bot dans ton serveur Discord privé.

### Récupérer les IDs

Dans Discord :

1. ouvre **User Settings → Advanced** ;
2. active **Developer Mode** ;
3. clique droit sur le serveur puis **Copy Server ID** ;
4. clique droit sur ton utilisateur puis **Copy User ID**.

Tu dois maintenant avoir :

- le token du bot ;
- l’ID du serveur, composé de 17 à 20 chiffres ;
- ton ID utilisateur, composé de 17 à 20 chiffres.

## 7. Télécharger HarnessHub

Depuis la VM, avec ton compte administrateur :

```bash
cd ~
git clone --branch feat/one-command-installer --single-branch https://github.com/ThibaultLombart/HarnessHub.git
cd HarnessHub
```

Vérifie la branche :

```bash
git branch --show-current
git status --short
```

Le premier résultat doit être `feat/one-command-installer` et le second ne doit rien afficher.

## 8. Lancer l’installation complète

```bash
sudo ./scripts/install.sh
```

L’installateur va :

1. vérifier la VM et les prérequis ;
2. demander le token Discord sans l’afficher ;
3. demander l’ID du serveur et ton ID utilisateur ;
4. exécuter le formatage, le lint, la compilation et les tests ;
5. créer l’utilisateur système `harnesshub` ;
6. installer HarnessHub dans `/opt/harnesshub` ;
7. installer Pi dans `/var/lib/harnesshub/tools` ;
8. écrire les secrets dans `/etc/harnesshub/harnesshub.env` avec des permissions restrictives ;
9. installer et démarrer le service systemd.

Lorsque l’installateur propose **Open Pi login now?**, appuie sur Entrée. Pi s’ouvre sous l’identité système utilisée par HarnessHub.

Dans Pi :

1. saisis `/login` ;
2. choisis ton fournisseur ;
3. termine son flux OAuth ou device-code natif ;
4. quitte Pi lorsque la connexion est terminée.

HarnessHub ne demande et ne stocke jamais le mot de passe du fournisseur.

## 9. Vérifier le service

```bash
sudo systemctl status harnesshub
```

Le service doit être `active (running)`.

Pour suivre les logs :

```bash
sudo journalctl -u harnesshub -f
```

Les logs ne doivent pas afficher le token Discord ou les identifiants du fournisseur. Quitte le suivi avec `Ctrl+C`.

## 10. Initialiser HarnessHub dans Discord

Dans le serveur configuré, exécute :

```text
/setup
```

HarnessHub doit créer :

```text
HARNESSHUB
└── #workspace-management
```

Le salon et la catégorie doivent être visibles uniquement par toi et par le bot.

Dans `#workspace-management`, exécute :

```text
/harness detect
/harness auth
```

La première commande doit afficher la version installée de Pi. La seconde doit confirmer qu’au moins un fournisseur est disponible.

## 11. Créer le premier projet

Dans `#workspace-management`, exécute :

```text
/project create name:premier-projet
```

HarnessHub doit créer le salon `#premier-projet` et le dépôt Git correspondant dans :

```text
/srv/harnesshub/workspaces/premier-projet
```

Dans `#premier-projet`, envoie un message normal :

```text
Crée un fichier README.md qui présente ce projet, puis affiche le statut Git.
```

Tu dois voir une progression compacte, puis la réponse finale de Pi.

Sur la VM, vérifie le résultat :

```bash
sudo -u harnesshub git -C /srv/harnesshub/workspaces/premier-projet status
sudo -u harnesshub cat /srv/harnesshub/workspaces/premier-projet/README.md
```

## 12. Vérifier la persistance après redémarrage

```bash
sudo systemctl restart harnesshub
sudo systemctl status harnesshub
```

Retourne dans `#premier-projet` et exécute :

```text
/project status
```

Le projet doit toujours être associé au même salon et au même dossier. Envoie ensuite un nouveau message pour vérifier la reprise de la session.

## 13. Activer les sauvegardes Proxmox

Dans Proxmox :

1. sélectionne **Datacenter → Backup** ;
2. ajoute une sauvegarde de la VM `harnesshub` ;
3. choisis un stockage de sauvegarde protégé ;
4. programme au minimum une sauvegarde quotidienne ;
5. active une politique de rétention adaptée.

Les sauvegardes contiennent le token Discord et les identifiants natifs de Pi. Elles doivent être chiffrées et accessibles uniquement aux administrateurs.

Avant un changement important, crée également un snapshot Proxmox. Un snapshot ne remplace pas une sauvegarde externe.

## Dépannage

### Le service échoue avec `status=200/CHDIR` ou `MODULE_NOT_FOUND`

Une ancienne version de l’installateur a pu rendre `/opt/harnesshub` ou ses fichiers compilés illisibles pour le compte système. Répare les modes de l’application, puis redémarre. Les secrets ne se trouvent pas dans ce répertoire :

```bash
sudo systemctl stop harnesshub
sudo chown -R root:root /opt/harnesshub
sudo chmod -R u=rwX,go=rX /opt/harnesshub
sudo systemctl reset-failed harnesshub
sudo systemctl start harnesshub
sudo systemctl status harnesshub --no-pager
```

### Le service ne démarre pas pour une autre raison

```bash
sudo systemctl status harnesshub
sudo journalctl -u harnesshub -n 100 --no-pager
```

Vérifie ensuite la configuration sans afficher le token :

```bash
sudo stat /etc/harnesshub/harnesshub.env
sudo grep -E '^(DISCORD_GUILD_ID|DISCORD_ADMIN_USER_ID|HARNESSHUB_)' /etc/harnesshub/harnesshub.env
```

Le fichier doit appartenir à `root:harnesshub` et avoir le mode `0640`.

### `/setup` échoue avec `DiscordAPIError[50013]`

Dans **Server Settings → Roles → HarnessHub**, accorde au rôle du bot **Manage Channels** et **Manage Roles**, sans lui donner **Administrator**. `Manage Roles` est nécessaire pour appliquer la frontière privée de la catégorie et des salons. Relance ensuite `/setup` ; la commande répare aussi un espace partiellement créé.

### `/setup` ou les commandes slash n’apparaissent pas

Vérifie que :

- le bot a bien été invité dans le serveur correspondant à `DISCORD_GUILD_ID` ;
- le scope `applications.commands` a été sélectionné ;
- le service est actif ;
- les logs ne signalent pas une erreur Discord.

Redémarre ensuite le service :

```bash
sudo systemctl restart harnesshub
```

### Pi signale `MissingSessionCwdError`

Une ancienne session Pi référence un dossier de travail qui n’existe plus. Cela n’endommage ni l’installation actuelle ni ses dépôts. Ne lance pas la commande de rollback si le service HarnessHub est déjà actif ; relance simplement l’authentification avec la commande propre ci-dessous.

### `/harness auth` ne trouve aucun fournisseur

Relance Pi avec son répertoire de configuration réel. Cette même commande contourne aussi `MissingSessionCwdError` :

```bash
sudo -u harnesshub env \
  --chdir=/var/lib/harnesshub \
  -u AI_AGENT -u PI_CODING_AGENT -u PI_SESSION_ID -u PI_SESSION_FILE \
  -u PI_PROVIDER -u PI_MODEL -u PI_REASONING_LEVEL \
  HOME=/var/lib/harnesshub \
  PI_CODING_AGENT_DIR=/var/lib/harnesshub/pi-agent \
  /var/lib/harnesshub/tools/node_modules/.bin/pi \
  --no-session --no-approve
```

Exécute `/login`, termine la connexion, puis quitte Pi. Les options `--no-session --no-approve` évitent de reprendre une ancienne session de développement pendant cette opération d’authentification.

### Réinstaller ou mettre à jour HarnessHub

Depuis un checkout propre de la branche voulue :

```bash
sudo ./scripts/install.sh
```

L’installateur conserve la configuration existante et déplace l’ancienne application vers un dossier `/opt/harnesshub.previous.<date>.<pid>`.

Pour remplacer volontairement la configuration Discord :

```bash
sudo ./scripts/install.sh --reconfigure
```

## Limite de sécurité du MVP

Pi et HarnessHub utilisent le même compte système non-root. La VM protège l’hyperviseur Proxmox et les autres machines, mais Pi n’est pas isolé de l’état HarnessHub accessible à ce compte. Cette VM doit être dédiée à HarnessHub et ne doit contenir aucun secret sans rapport avec ses projets.

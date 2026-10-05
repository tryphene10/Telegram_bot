# Outils avances du worker

Git, Docker, Browser Agent et Computer Use sont desactives par defaut. Le worker ne les
enregistre que si le manifeste persiste est valide, correspond exactement au projet, a la
machine et au chemin racine de la mission, et contient la section explicite concernee.

Exemple d'extensions au manifeste version 1 :

```json
{
  "git": {
    "enabled": true,
    "executablePath": "C:\\Program Files\\Git\\cmd\\git.exe"
  },
  "docker": {
    "executablePath": "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
    "projectName": "arcc-sandbox",
    "composeFiles": ["compose.yaml"],
    "services": ["api", "postgres"],
    "imagePrefixes": ["registry.example/arcc"],
    "environment": "DEVELOPMENT"
  },
  "browser": {
    "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "allowedDomains": ["docs.example.com"],
    "headless": true
  },
  "computerUse": {
    "applications": [
      {
        "appKey": "editor",
        "executablePath": "C:\\Program Files\\Microsoft VS Code\\Code.exe",
        "executableSha256": "<sha256-optionnel-64-caracteres>",
        "windowTitlePrefixes": ["ARCC Sandbox - "]
      }
    ]
  }
}
```

Les chemins d'executables doivent etre absolus et exister. Git et Docker n'acceptent que
leurs executables attendus. Computer Use est limite a Chrome, Edge, VS Code, Notepad et
Explorer, puis verifie le chemin du processus, son hash s'il est fourni et le titre de la
fenetre. Les domaines navigateur sont des noms d'hote HTTPS exacts ; aucun joker n'est
accepte.

Les actions Git/Docker restent structurees, sans arguments bruts ni shell. Les chemins et
fichiers Compose passent par le confinement du manifeste. Les publications, acces reseau,
commits et actions a haut risque exigent l'approbation forte. Toutes les mutations Computer
Use sont classees `CRITICAL`, exigeant un PIN Owner ; l'ID, le hash, la mission, le niveau et
l'expiration de l'approbation sont reverifies dans PostgreSQL juste avant l'action. Le fichier
`%ARCC_DATA_ROOT%\\computer-use.stop.json` arrete immediatement les actions de bureau.

Le navigateur emploie un profil dedie sous `%ARCC_DATA_ROOT%\\browser`, bloque les requetes
hors domaines autorises, met en quarantaine les telechargements refuses et interdit toujours
le paiement autonome ainsi que le contournement de CAPTCHA ou MFA.

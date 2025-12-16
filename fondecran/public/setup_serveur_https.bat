@echo off
setlocal
REM === Dossier de base ===
set "BASE_DIR=%~dp0fondecran"
set "CERT_DIR=%BASE_DIR%\cert"
set "PUBLIC_DIR=%BASE_DIR%\public"
REM === Créer dossier cert si absent ===
if not exist "%CERT_DIR%" (
    mkdir "%CERT_DIR%"
)
REM === Générer certificat auto-signé si absent ===
if not exist "%CERT_DIR%\key.pem" (
    echo Génération du certificat SSL...
    pushd "%CERT_DIR%"
    bash -c "openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj \"/CN=localhost\""
    popd
)
REM === Créer server.js si absent ===
if not exist "%BASE_DIR%\server.js" (
    echo const fs = require('fs');> "%BASE_DIR%\server.js"
    echo const https = require('https');>> "%BASE_DIR%\server.js"
    echo const express = require('express');>> "%BASE_DIR%\server.js"
    echo const app = express();>> "%BASE_DIR%\server.js"
    echo app.use(express.static(__dirname + '/public'));>> "%BASE_DIR%\server.js"
    echo const options = {>> "%BASE_DIR%\server.js"
    echo ^  key: fs.readFileSync(__dirname + '/cert/key.pem'),>> "%BASE_DIR%\server.js"
    echo ^  cert: fs.readFileSync(__dirname + '/cert/cert.pem')>> "%BASE_DIR%\server.js"
    echo };>> "%BASE_DIR%\server.js"
    echo https.createServer(options, app).listen(443, () => {>> "%BASE_DIR%\server.js"
    echo ^  console.log('Serveur HTTPS lancé sur https://localhost');>> "%BASE_DIR%\server.js"
    echo });>> "%BASE_DIR%\server.js"
)
REM === Lancer le serveur et ouvrir Edge ===
cd /d "%BASE_DIR%"
start microsoft-edge:https://localhost
echo Lancement du serveur Node.js...
node server.js
endlocal
pause
const fs = require('fs'
const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(__dirname + '/public'));
const options = {
  key: fs.readFileSync(__dirname + '/cert/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert/cert.pem')
https.createServer(options, app).listen(443, () =
  console.log('Serveur HTTPS lancé sur https://localhost');
const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(__dirname + '/public'));
const options = {
  key: fs.readFileSync(__dirname + '/cert/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert/cert.pem')
https.createServer(options, app).listen(443, () =
  console.log('Serveur HTTPS lancé sur https://localhost');
const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(__dirname + '/public'));
const options = {
  key: fs.readFileSync(__dirname + '/cert/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert/cert.pem')
};
https.createServer(options, app).listen(443, () =
  console.log('Serveur HTTPS lancé sur https://localhost');
});
const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(__dirname + '/public'));
const options = {
  key: fs.readFileSync(__dirname + '/cert/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert/cert.pem')
};
https.createServer(options, app).listen(443, () =
  console.log('Serveur HTTPS lancé sur https://localhost');
});
const https = require('https');
const express = require('express');
const app = express();
app.use(express.static(__dirname + '/public'));
const options = {
  key: fs.readFileSync(__dirname + '/cert/key.pem'),
  cert: fs.readFileSync(__dirname + '/cert/cert.pem')
};
https.createServer(options, app).listen(443, () =
  console.log('Serveur HTTPS lancé sur https://localhost');
});

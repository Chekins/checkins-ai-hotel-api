require("dotenv").config();
const express = require("express");
const cors = require("cors");
const compression = require('compression');
const hotelRoutes  = require("./routes/routes");
const rateLimit = require('express-rate-limit');
const bodyParserXml = require('body-parser-xml');
const bodyParser = require('body-parser');
const app = express();

app.use(compression());

// Configure JSON body parser
app.use(bodyParser.json({
  limit: '50MB', // Reject payload bigger than 1 MB
}));

// Configure XML body parser using bodyParserXml
bodyParserXml(bodyParser);

app.use(bodyParser.xml());

//Cors Configuration - Start
const corsOptions = {
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  allowedHeaders: "*",
  preflightContinue: false
};

app.use((req, res, next) => {
  req.ip = req.body.ipAddress; // Extract the client's IP address from the request headers
  console.log(req.ip);
  next();
});

app.options('*', cors());

app.use(cors(corsOptions));

// Apply the rate limiting middleware to all requests
// app.use(limiter);

app.use(hotelRoutes.routes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});

module.exports = app;

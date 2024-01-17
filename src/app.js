const express = require('express');
const apiRoutes = require('./routes/api');

const app = express();

app.use(express.json());
app.use('/api', apiRoutes);

module.exports = app;

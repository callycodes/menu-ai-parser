const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const menuController = require('../controllers/menu');

router.post('/upload-menu', upload.single('menu'), menuController.parseMenu);

module.exports = router;

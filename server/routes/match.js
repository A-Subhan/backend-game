const express = require('express');
const router = express.Router();

// Placeholder match route
router.get('/', (req, res) => {
  res.json({ message: 'Match API is available' });
});

module.exports = router;

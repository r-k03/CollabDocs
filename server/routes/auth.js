/**
 * Auth routes
 *
 * POST /api/auth/register - sign up
 * POST /api/auth/login - login and get token
 * GET  /api/auth/me - get current user (needs auth)
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { jwtSecret, jwtExpiresIn } = require('../config/env');

const router = express.Router();

/**
 * Make a JWT token for a user
 */
const generateToken = (userId) => {
  console.log("generating token");
  return jwt.sign({ userId }, jwtSecret, { expiresIn: jwtExpiresIn });
};

/**
 * Register endpoint
 */
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }

  const existingUser = await User.findOne({ $or: [{ email }, { username }] });
  if (existingUser) {
    return res.status(409).json({
      error: existingUser.email === email
        ? 'Email already registered.'
        : 'Username already taken.',
    });
  }
  console.log("reached",username, email, password);
  const user = await User.create({ username, email, password });
  console.log("created user");
  const token = generateToken(user._id);
  console.log("generated token");
  res.status(201).json({
    token,
    user: { id: user._id, username: user.username, email: user.email },
  });
  console.log("sent token");
});

/**
 * Login endpoint
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // Need to explicitly select password since it's hidden by default
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = generateToken(user._id);

  res.json({
    token,
    user: { id: user._id, username: user.username, email: user.email },
  });
});

/**
 * Get current user info
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;

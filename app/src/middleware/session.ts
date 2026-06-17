// src/middleware/session.ts
import session from 'express-session';
import redisClient from '../lib/redis';

const RedisStore = require('connect-redis').RedisStore;

const store = new RedisStore({ 
  client: redisClient,
  prefix: 'sess:',
});

export const sessionMiddleware = session({
  store,
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
    // secure: false, // Set to true if using HTTPS in production
  },
});

// sess:yt9iJFSTweiv5q5PTtMQ5mIaMOykDRaj

// s:yt9iJFSTweiv5q5PTtMQ5mIaMOykDRaj.KhfTSt625qJrkfeVxK72gg2uImlw/wdyB7/sqPx829I
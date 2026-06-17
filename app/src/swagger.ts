// src/swagger.ts
const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'Redis In Action: Project 1',
    description: 'Redis Fast Session Storage for Web Applications.',
  },
  host: 'localhost:3000',
  schemes: ['http'],
};

const outputFile = '../swagger-output.json';
const endpointsFiles = ['./index.ts']

swaggerAutogen(outputFile, endpointsFiles, doc);
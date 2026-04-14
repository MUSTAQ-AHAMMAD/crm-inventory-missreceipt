/**
 * Swagger / OpenAPI specification configuration.
 * Collects JSDoc annotations from all route files to build the API docs.
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CRM Inventory & Receipt API',
      version: '1.0.0',
      description:
        'Full-stack CRM application for managing Oracle Cloud inventory uploads, miscellaneous receipts (SOAP), and standard receipts (REST).',
    },
    servers: [{ url: `http://localhost:${process.env.PORT || 4000}/api` }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  // Scan all route files for JSDoc @swagger annotations
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

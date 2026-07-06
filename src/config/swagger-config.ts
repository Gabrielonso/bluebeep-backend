import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const ConfigureSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('Bluebeep APIs')
    .setDescription('API for Bluebeep')
    .addBearerAuth()
    .setVersion('1.0')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      docExpansion: 'none',
      persistAuthorization: true,
      filter: true,
    },
    customSiteTitle: 'Bluebeep API Docs',
  });
};

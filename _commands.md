# Commands

## Project dependencies

```
npm install express  
npm install swagger-ui-express  
npm install @prisma/client  
npm install prisma --save-dev  
npm install -D typescript  
npm install -D ts-node-dev  
npm install -D nodemon  
npm install -D @types/node  
npm install -D @types/express  
npm install -D @types/swagger-ui-express  
npm install -D swagger-autogen  
npm install -D swagger-jsdoc  

npm install express-session  
npm install connect-redis  
npm install ioredis
npm install -D @types/express-session
```

## Docker Commands

Start Docker Container
```
docker compose up --build -d
```

## Run Prisma Studio manually 
```
npx prisma studio
docker exec -it express_api npx prisma studio
```
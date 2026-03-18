FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN bunx prisma generate
EXPOSE 3000
CMD ["bun", "src/index.ts"]

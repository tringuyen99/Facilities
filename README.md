# Facility Search API

A REST API for searching and filtering fitness facilities, built for the coding.

Search runs on PostgreSQL trigram indexes. All numbers in this file were
measured against **100,000 facilities**.


|               |                                                                   |
| ------------- | ----------------------------------------------------------------- |
| Runtime       | Node 26.11.1 (native TypeScript, no transpiler in dev)            |
| Language      | TypeScript 7                                                      |
| Framework     | Fastify 5, with Zod driving validation, serialisation and OpenAPI |
| Data          | Prisma 7 + PostgreSQL 18                                          |
| Auth          | argon2id + JWT                                                    |
| Rate limiting | Redis-backed                                                      |


## Prerequisites


|                                               | Version         |     |
| --------------------------------------------- | --------------- | --- |
| [Node](https://nodejs.org)                    | 26.11.1         |     |
| [pnpm](https://pnpm.io)                       | 11.0.8          |     |
| [Docker](https://docs.docker.com/get-docker/) | with Compose v2 |     |


```bash
fnm use           # or `nvm use`. Both read .node-version
corepack enable   # provides pnpm at the pinned version
```

The commands below use `openssl` and `jq`. Both are already installed on macOS
and on most Linux distributions.

## Getting started

**1. Install dependencies**

```bash
pnpm install
```

The `prepare` hook runs `prisma generate`, which writes the typed client to
`src/generated/prisma`. Nothing is compiled; Node reads the TypeScript as-is.

**2. Create your `.env`**

```bash
cp .env.example .env
openssl rand -base64 32    # paste into JWT_SECRET
```

Every variable is validated at startup. A missing or too short `JWT_SECRET`
stops the server immediately and the error says which variable is wrong, so you
find the problem at startup instead of at the first login. The other defaults
already match `compose.yaml`.

**3. Start Docker**

Open Docker Desktop, or start whichever daemon you use, for example
`colima start`. The next step needs it.

```bash
docker info     # prints the server section when the daemon is up
```

**4. Start PostgreSQL and Redis**

```bash
pnpm db:up     # docker compose up -d --wait
```

Postgres on `:5432`, Redis on `:6379`, both from `compose.yaml`. The command
waits for both health checks, so the next step cannot run before the database is
ready. `pnpm db:down` stops them again.

**5. Apply migrations**

```bash
pnpm db:migrate
```

Creates the tables and the indexes search needs. See
[Search performance](#search-performance) for what they do.

**6. Load data**

```bash
pnpm seed -- 100000       # generate → data/facilities.json
pnpm seed:db -- --fast    # load into Postgres (~12s)
```

The generator is deterministic for a given `--seed`, so the same command always
produces the same 100,000 facilities. To load the 100 sample records from the
brief instead:

```bash
pnpm seed:db -- --file assets/facilities.json
```

**7. Run the server**

```bash
pnpm dev     # watch mode
```

Open [**http://localhost:3000/docs**](http://localhost:3000/docs) for the Swagger UI, or go to
[Try it](#try-it) for a request you can copy.

To confirm everything works:

```bash
pnpm check   # typecheck + lint + 92 tests against the real database
```

## API


| Method | Path              | Auth   | Description                    |
| ------ | ----------------- | ------ | ------------------------------ |
| `POST` | `/auth/register`  | none   | Create an account              |
| `POST` | `/auth/login`     | none   | Exchange credentials for a JWT |
| `GET`  | `/facilities`     | Bearer | Search and filter              |
| `GET`  | `/facilities/:id` | Bearer | One facility, with amenities   |
| `GET`  | `/health`         | none   | Liveness probe                 |
| `GET`  | `/docs`           | none   | Swagger UI                     |


### Searching

```
GET /facilities?nameContains=city&addressContains=bondi&amenityAnyOf=Pool&amenityAnyOf=Sauna&limit=20&offset=0
```


| Parameter         | Notes                                                           |
| ----------------- | --------------------------------------------------------------- |
| `nameContains`    | Case-insensitive substring. Wildcards are escaped, not honoured |
| `addressContains` | As above                                                        |
| `amenityAnyOf`    | Repeatable, max 20. A facility must have **any** one listed     |
| `limit`           | 1 to 100, default 20                                            |
| `offset`          | ≥ 0, default 0                                                  |


Parameter names describe what they do. `nameContains` instead of `name`, because
it matches a substring and not the whole value. `amenityAnyOf` instead of  
`amenity` because it matches one of them.

Filters are combined with AND (name AND address AND amenities). Only the values
inside `amenityAnyOf` are combined with OR.

```json
{
  "data": [
    {
      "id": "facility-000444",
      "name": "Harbour View Aqua 24/7",
      "address": "503 High Pde, South Bank, QLD 4034",
      "latitude": -27.5903,
      "longitude": 153.1024
    }
  ],
  "pagination": { "limit": 20, "offset": 0, "hasMore": true }
}
```

## Try it

```bash
curl -X POST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-sufficiently-long-password"}'

TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-sufficiently-long-password"}' | jq -r .token)

curl -H "authorization: Bearer $TOKEN" \
  'localhost:3000/facilities?nameContains=harbour&limit=3'
```

## Architecture

I did not add controllers, services or repositories. A request goes through two
layers and then hits the database:

```
routes/     HTTP only. Zod schemas, status codes, reading request.user
domain/     the queries. Takes a PrismaClient, returns plain data
```

A handler in `routes/facilities.ts` validates the querystring with Zod, calls one
function from `domain/facilities/operations.ts`, and turns the result into a
status code. 

I also call Prisma directly in `domain/` instead of putting a repository in front of it. Prisma is already the data access layer. Wrapping it again introduces type complexity while provides minimal benefits.

### Why I left the layers out

Every time I have added an abstraction early, I was guessing where the complexity was going to show up, and I usually guessed wrong. The annoying part is that the wrong boundary is much harder to take out than it was to put in.

Right now this API has two read endpoints and two auth endpoints. A controller layer and a service layer would just be empty proxies that provides no benefits.

I would rather wait until the code asks for them. For me that moment is fairly
specific:

- I would add a **controller** when an endpoint needs to read from several
sources and combine them. Once you are fetching from two or three places,
merging the results and deciding what to do when one of them fails, that is
real logic, and I do not want it sitting in a route handler next to the status
codes.
- I would add a **service** when the same operation has more than one caller.
Two routes, or a route and a background job, or a route and a script. At that
point I want one copy of it with its own tests, not the same thing written out
twice.

Neither has happened yet. Every function in `domain/` has exactly one caller, and
no endpoint reads from more than one place. If that changes, moving a function
into a service is a small and safe refactor. 

## Project layout

```
src/
  server.ts              entry point, graceful shutdown
  app.ts                 buildApp(). No port bound, so tests use inject()
  config.ts              env parsing, fails fast on boot
  clients/               db.ts and redis.ts. Factories, no module singletons
  domain/
    facilities/          schemas.ts (Zod contract) + operations.ts (queries)
    users/               same shape
  routes/                HTTP only: schemas, status codes
  plugins/               auth, caching, rate limiting, swagger
  lib/                   http-error.ts, result.ts, logger.ts
scripts/
  generate-facilities.ts deterministic seed data, up to 100k
  seed-db.ts             loads it into Postgres
```

`buildApp()` is separate from `server.ts` so that tests can call `app.inject()`
directly. No sockets, no port conflicts, and the whole suite finishes in about
one second.

There are no module level singletons for the database or for Redis.
`createPrismaClient(url)` and `createRedisClient(url, log)` are called once by
`buildApp()`, which owns both clients and closes them on `onClose`. This is what
allows a test to create two separate apps in the same process.

Each domain keeps its Zod schemas separate from its queries, so `schemas.ts`
imports only Zod. It can be read or tested without a database.

## Commands

```bash
pnpm check          # typecheck + lint + test
pnpm test           # 92 tests
pnpm build          # → dist/
pnpm seed -- 1000   # regenerate seed data (deterministic for a given seed)
pnpm db:studio      # browse the database
```

## Testing

92 tests on Node's built-in runner, so there is no test framework to install.
They run against a real PostgreSQL, because most of what is worth testing here is
PostgreSQL behaviour: which index is used, wildcard escaping, whether pages stay
stable when the sort key is not unique, and unique constraint races.

Each suite creates and removes its own fixtures. Every file passes alone and also
in the full run.

### No test isolation

The tests run against the same local
database that `pnpm dev` uses. There is no isolation between a test run and the development data, and no isolation between test files beyond the fixtures that each suite creates and deletes itself.

The proper fix is a fresh database per run.
[Testcontainers](https://node.testcontainers.org) would start a real Postgres
container for the suite and throw it away afterwards, which keeps the behaviour
that matters here, since these tests exist to check PostgreSQL behaviour.
[PGlite](https://github.com/electric-sql/pglite) is the lighter option and needs no Docker.

---

# Implementation notes

## Search performance

`name` and `address` have trigram (GIN) indexes. Results are sorted by
`(name, id)`. Timings are end to end against 100,000 rows. The plans come from  
`EXPLAIN ANALYZE` on the statement that Prisma sends, taken from its query log:

```sql
SELECT "id", "name", "address", "latitude", "longitude" FROM "public"."Facility"
WHERE "name" ILIKE ('%' || $1 || '%')
ORDER BY "name" ASC, "id" ASC LIMIT $2 OFFSET $3
```

The pattern is built from a parameter instead of being written directly in the
SQL. This does not change how the planner estimates the number of rows.


| `nameContains=`  | matches | plan           | limit=20 | limit=100 |
| ---------------- | ------- | -------------- | -------- | --------- |
| `anytime`        | 5,462   | btree + filter | 0.8 ms   | 0.7 ms    |
| `apex`           | 5,642   | btree + filter | 4.1 ms   | 4.9 ms    |
| `city`           | 5,665   | btree + filter | 6.3 ms   | 6.3 ms    |
| `core`           | 5,587   | btree + filter | 12.7 ms  | 13.8 ms   |
| `harbour`        | 5,714   | btree + filter | 16.8 ms  | 17.5 ms   |
| `metro`          | 5,520   | btree + filter | 23.2 ms  | 23.6 ms   |
| `prime`          | 5,545   | btree + filter | 31.6 ms  | 32.2 ms   |
| `suburban`       | 5,536   | btree + filter | 40.4 ms  | 40.8 ms   |
| `zenith`         | 5,586   | btree + filter | 48.2 ms  | 49.0 ms   |
| `aqua`           | 8,336   | btree + filter | 1.1 ms   | 1.0 ms    |
| `gym`            | 8,409   | btree + filter | 0.7 ms   | 1.5 ms    |
| `zenith aqua`    | 442     | **trigram**    | 1.9 ms   | 2.4 ms    |
| `zenith aqua hq` | 36      | **trigram**    | 2.0 ms   | 2.0 ms    |
| `xyzzy`          | 0       | **trigram**    | 0.5 ms   | 0.6 ms    |


### Offset flips the plan


| `nameContains=` | offset=0       | offset=1000    | offset=5000         | offset=50000   |
| --------------- | -------------- | -------------- | ------------------- | -------------- |
| `aqua`          | btree 0.0 ms   | btree 6.3 ms   | **trigram 10.8 ms** | trigram 9.6 ms |
| `zenith`        | btree 42.3 ms  | btree 43.2 ms  | **trigram 6.4 ms**  | trigram 6.4 ms |
| `zenith aqua`   | trigram 1.3 ms | trigram 1.4 ms | trigram 1.3 ms      | trigram 1.3 ms |


A big offset makes the planner switch from the btree to the trigram index.  The switch happens around 1,500 to 2,000 rows.

Slow terms get faster, fast terms get slower. `zenith` 42 ms to 6.4 ms, `aqua`
0.0 ms to 10.8 ms.

### Why is trigram index not used?

This needs more digging, but it looks like the planner prefers the btree when a term is common and matches a lot of rows. The trigram index is there for the uncommon terms and when offset is big.

### Why the sort key is `(name, id)`

There are 2,592 distinct names across
100,000 rows, so about 38 facilities share each name. If the sort uses `name`
only, those rows have no fixed order, and `LIMIT/OFFSET` then cuts through an
order that can change between queries. 

## Amenity filtering

```ts
filters.push({
	amenities: { some: { amenity: { name: { in: amenitiesAnyOf } } } },
});
```

 On 100,000 rows, median of 11: 2.7 ms with one value, and 0.8 ms from 3 values up to all 31. The 20 value limit is only a check on querystring size. There are 31 amenities,  
so a request with more distinct values than that cannot match anything.

## Rate limiting

Rate limiting is based on the user id from the JWT. Login and register have no
user yet, so those two are keyed on the client address.

Ideally, in a real production infrastructure, the API gateway or load balancer should handle IP rate limiting, which leaves the application free to limit on known users. An in-process limiter  
has already accepted the connection, parsed the headers and called Redis by the time it rejects anything. Other option is to have 2 layers of rate limiting, before and after auth is verified, but it complicates the implementation real quick.


| Scope                 | Window     | Default max | Keyed by           |
| --------------------- | ---------- | ----------- | ------------------ |
| Global                | 1 minute   | 10,000      | verified JWT `sub` |
| `POST /auth/login`    | 15 minutes | 10,000      | client address     |
| `POST /auth/register` | 1 hour     | 10,000      | client address     |
| `GET /health`         | n/a        | exempt      | n/a                |
| `/docs`               | n/a        | exempt      | n/a                |


**These defaults are not production values.** All three come from the environment, through `RATE_LIMIT_MAX`, `RATE_LIMIT_LOGIN_MAX` and `RATE_LIMIT_REGISTER_MAX`,
so lowering them is a deployment setting and not a code change.

The counters are in Redis, so they are shared between instances. If Redis is
down, the limiter fails **open**: it logs the problem and serves the request.

### Why authenticated requests are keyed by user, not address

The limiter runs on `preHandler`, after the JWT is verified, so `request.user.sub`
comes from a token that has been checked. If it used an unverified `sub`, someone
could put a victim's id into a fake token and use up that victim's budget. 

### Known limitation

Because the limiter runs after authentication, **requests without a token to
protected routes, and 404 scanning, are not counted here.** That is the job of the
edge. With nothing in front of it, this service is open to that traffic. The
login and register limits still work, because those routes are public and the
hook reaches them.

## Caching

Responses carry `Cache-Control` and an `ETag`. Caching is **opt in per route**,
so any route that does not ask for it gets `no-store`.


| Route                            | Directive              |
| -------------------------------- | ---------------------- |
| `GET /facilities/:id`            | `private, max-age=300` |
| `GET /facilities`                | `private, max-age=60`  |
| Everything else, and all 4xx/5xx | `no-store`             |


`private`, never `public`. These endpoints need a token, and a shared cache
holding a `public` response would give facility data to anyone who knows the URL.
Cacheable responses also send `Vary: Authorization`. Without that header, a
browser cache uses only the method and the URL as its key, so after a logout or a
change of account it would serve the body of the previous session from disk.

**There is no server-side cache yet, on purpose.** A typical search is a few milliseconds of database work under about 4 ms of framework overhead. A cache could only remove the smaller half of that, and PostgreSQL's shared buffers already keep the hot rows in memory. Facility detail is a 1.2 ms indexed lookup against a Redis round trip of about 0.3 ms. 

One known quirk: `@fastify/etag` does not look at status codes, so replaying the hash of an error body returns a 304. Normal clients never reach it either, because a real ETag is the  
hash of a *successful* body and will not match an error.

## What I would do next

Gaps that I know about, roughly in the order I would fix them:

- **Investigate trigram index usage in the query planner.** `nameContains=zenith`
takes 48 ms where `nameContains=anytime` takes 0.8 ms, and both match about the  
same number of rows. **trigram index was not used.** I ran out of time to work out why.
- **Revisit rate limiting and caching.** The defaults are nonsense, and real values need to go in the environment before this is exposed. Beyond that, the windows and the cache  
max-age values were picked from local measurements and a guess at how the API would be used, as was the decision to skip a server-side cache. All of it should  
be checked against real traffic.
- **Tests have no isolation.** They run against the local development database.
A container per run, with Testcontainers or PGlite, would remove the shared
state and let the suite run anywhere. See [No test isolation](#no-test-isolation).
- **The amenity names cannot be discovered.** There is no endpoint that lists
them and no enum in the OpenAPI schema, so a client has to learn them from the
data.
- **`?amenityAnyOf=` only supports OR.** There is no way to ask for "Pool *and*
Sauna". The natural addition is a second parameter, `amenityAllOf`, rather than
a mode flag, so each parameter still describes what it does. AND is the
expensive shape, so that path would need the limit of 20 values.
- **No CORS.** A type ahead running in a browser cannot call this from another
origin yet.
- **No refresh tokens.** Access tokens last one hour and cannot be revoked
earlier. A refresh token with a denylist on the server is the usual next step.
- **No CI.** `pnpm check` is the whole pipeline, but nothing runs it
automatically.


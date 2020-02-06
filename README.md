# tusk - opinionated type-safe routing for koa

tusk is a routing middleware for [koa](https://koajs.com/) that provides type-safe query & parameter validation via [io-ts](https://github.com/gcanti/io-ts).

## todos

- [ ] add tests
- [ ] add json body parsing
- [ ] consider using json schema + generated interfaces for json validation
- [ ] make the actual routing logic less... bad?
- [ ] allow using intersection types to define responses
- [ ] make validation errors catchable + have default error handler for them

## why

tusk's goal is to solve two problems:

1) provide a simple, declarative, boilerplate-free way to get validated route parameters and their resulting static type

2) provide a simple, type-safe way to inject per-request context into your route handlers

### parameters

tusk uses [io-ts](https://github.com/gcanti/io-ts) to validate incoming route and query parameters. io-ts is a runtime dsl that corresponds to typescript types, and makes it easy to extract a static type from a runtime type. while all incoming query and parameter types start as type `string,` io-ts codecs like `IntFromString` can be used to safely convert to other types.

currently, io-ts is also used to validate return values as well, but this is kind of silly because the actual _type checking_ should be able to cover return values. i have considered adding some sort of json schema validation for this (as well as for json body types) instead, though i'm not happy with the boilerplate of both defining a json schema and the interface it represents.

### context

traditionally, per-request contexts in frameworks like koa or express are defined by attaching additional state to the arguments passed through middleware. in other words, if you have a middleware that gets the current user, it would set it on `req.user` (express) or `ctx.state.user` (koa).

this sort of composed state is powerful due to, well, its composabiity, but it turns out it's _really, really hard_ to correctly type in typescript. in tusk, i've instead tried to simplify things with the concept of a _router context_ - which is, in essence, a single piece of middleware that gets applied to a route handler to supply its initial state.

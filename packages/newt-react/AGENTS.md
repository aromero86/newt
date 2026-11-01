# newt-kit-react, for coding agents

What a React frontend of a newt application thinks with. How it looks is
newt-kit-react-ui's (read its AGENTS.md before any page). Here: where state lives, how it
reaches the API, how forms and lists work.

## The shape of a frontend

- **A page renders, and does nothing else.** It reads a service's signals with
  `useValue`, calls its methods on events, and composes newt-kit-react-ui's components.
  No `fetch`, no business rule, no state beyond a toggle.
- **A service holds the state and the logic** of one thing: a class with a `Store`,
  whose parts it exposes as read-only signals (`store.select('items')`), and methods
  that change it. It gets what it needs with `inject(OtherService)`.
- **An API client is one class per backend module**, extending `Requester`: its `path`,
  and one method per route, typed with the module's own contract (its `*.schema.ts`
  types, through `newt-kit/contract`). Never `fetch` anywhere else. Never name a method
  `get`, `post`, `put`, `patch` or `delete`: it would hide `Requester`'s own, and the
  client would call itself forever (`app(id)`, not `get(id)`).

```ts
export class AppApi extends Requester {
  protected readonly path = '/apps'
  list(page: PageRequest & { status?: 'active' | 'archived' | 'all' }) { return this.get<Page<AppDTO>>('', page) }
  register(input: AppRegisterDTO) { return this.post<AppDTO>('', input) }
}

export class AppsService {
  private readonly api = inject(AppApi)
  readonly list = new ListStore<AppDTO>(page => this.api.list(page))
}

function AppsPage() {
  const apps = useService(AppsService)
  const items = useValue(apps.list.items)
  useEffect(() => { void apps.list.loadFirstPage() }, [apps])
  return <Box>{items.map(app => <BoxRow key={app.id}>…</BoxRow>)}</Box>
}
```

## Services and their injector

- `useService(Service)` in a component, `inject(Service)` in a service: one instance
  per injector. The root injector makes any service the first time it is asked.
- `<Provide services={[EditorService]}>` gives a part of the tree its own instances:
  a page's state that must start fresh each time the page opens. They are disposed
  (`dispose()`, `Disposable`) when it unmounts.
- A service built while another opens may not see the page's params yet: pass them to
  a method (`load(id)`), never to the constructor.

## Forms

`FormStore` validates with the **same zod schema the backend parses with**, before
sending, and maps the backend's error codes to fields:

```ts
readonly form = new FormStore(AppRegisterSchema, { name: '', url: '', key: '' }, {
  errorFields: { 'app.name_taken': 'name', 'app.key_rejected': 'key', 'app.unreachable': 'url' },
  messages: { 'app.bad_answer': 'That address is no monitor endpoint' },
})
save = () => this.form.submit(input => this.api.register(input))
```

`<FormField form={form} name="url" label="Address" />` (`newt-kit-react/form-field`) is a
newt-kit-react-ui field bound to it: value, change and error. `rows` makes it a textarea,
`options` a select. A failure that belongs to no field is `form.failure`.

## Lists

`ListStore` pages as newt pages (`Page`, a cursor): `loadFirstPage`, `loadMore`,
`hasMore`, `loading`, and `prepend`, `replace`, `remove` to keep it in step after a
change without reloading. A list the backend bounds (a workspace's members) is plain
state in a service, whole.

## Errors and the session

Every failed request is an `ApiError`: its HTTP `status`, its `message`, and newt's
error `code` (`app.not_found`). Status 0 is no answer at all. Show the message with
newt-kit-react-ui (`Alert`, `toast`), and branch on `code`, never on the message.
`Requester.onUnauthorized` is called on any 401: send the person to sign in there,
once. `Requester.baseUrl` is `/api` unless the app serves its API elsewhere.

## Theme

`ThemeService` keeps the `dark` class on `<html>` and remembers the choice
(`THEME_STORAGE_KEY`). The app's `index.html` applies it before the first paint.

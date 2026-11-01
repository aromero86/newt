# newt-kit-react

What a React frontend of a newt application thinks with: a service's state (`Store`,
`useValue`), services and their injector (`inject`, `useService`, `Provide`), forms
validated with the backend's own schemas (`FormStore`), lists paged as newt pages them
(`ListStore`), the requests to a newt API (`Requester`, `ApiError`), and the theme.
How it looks is [newt-kit-react-ui](../newt-react-ui)'s; `newt-kit-react/form-field` ties the two.

How an app is written with it: [AGENTS.md](./AGENTS.md). `newt init` imports it in the
app's CLAUDE.md.

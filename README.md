# L'Oréal Routine Builder

A product-aware beauty routine builder using the catalog in `products.json` and a Cloudflare Worker to protect the OpenAI API key.

## Run the frontend locally

Serve this folder over HTTP so the browser can load `products.json`. For example, with the VS Code Live Server extension, choose **Open with Live Server** on `index.html`. The Worker CORS defaults allow `http://localhost:5500` and `http://127.0.0.1:5500`.

## Deploy the Cloudflare Worker

The frontend is configured with the deployed Worker URL supplied for this project. It sends `POST` requests containing a `messages` array. The included `worker/index.js` is a deployable implementation if you need to manage or replace that Worker; you do not need to deploy a second Worker just to try the configured endpoint.

1. Sign in to Wrangler using the Cloudflare account that will host the Worker:

	```sh
	npx wrangler login
	```
2. From the project folder, add the OpenAI key as a Worker secret. Do not put it in a frontend file or commit it:

	```sh
	npx wrangler secret put OPENAI_API_KEY
	```

3. If the frontend is hosted somewhere other than the two local addresses, change `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin(s) where the site is hosted. Multiple origins can be comma-separated. Deploy:

	```sh
	npx wrangler deploy
	```

4. If you deploy this included Worker, copy the `workers.dev` URL Wrangler prints and set `WORKER_URL` near the top of `script.js` to that exact URL, including its trailing slash. The URL is public configuration; the API key remains a Worker secret.
5. Redeploy the static frontend after changing `WORKER_URL`.

The Worker uses `gpt-4.1`, adds its own server-side advisor instructions, validates conversation messages, and returns understandable errors for rate limits and failed API responses. The optional live web-search extra is not enabled; responses do not claim to include current web research.

## Product and conversation data

Selected product IDs are stored in this browser's local storage. Conversation content and product details are sent to the configured Worker only when the user requests routine guidance or submits a follow-up. The API key is never stored in browser storage.
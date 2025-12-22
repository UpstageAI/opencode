# Small Screen Responsiveness

The TUI uses two dimension checks for responsiveness: `wide` (width > 120) controls sidebar visibility and the "tab switch agent" hint, while `tall` (height > 40) controls the footer and whether agent/model info appears inside the input box or on the hints row. When not tall, the agent/model info moves to the bottom hints row and shares space with the loading spinner (they are mutually exclusive - loader shows when busy, agent/model shows when idle).

Files edited: `routes/session/index.tsx` defines `wide`, `tall`, and `sidebarVisible` memos and conditionally renders the Header, Footer, and Sidebar. `routes/session/header.tsx` was simplified to remove the share section entirely. `component/prompt/index.tsx` has its own `wide` and `tall` memos and handles the responsive input box layout - hiding agent/model from inside the box when not tall, showing it on the hints row instead, and hiding "tab switch agent" when not wide.

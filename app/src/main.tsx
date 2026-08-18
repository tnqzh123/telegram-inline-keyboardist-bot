import React from "react";
import ReactDOM from "react-dom/client";
import "@telegram-apps/telegram-ui/dist/styles.css";
import "./styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

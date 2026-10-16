import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/workbench/App";
import { PrimitiveShowcase } from "./showcase/PrimitiveShowcase";
import "./styles/global.css";
import "./styles/workspace-theme.css";
import { installWebHost } from "./web-host";

function Root() {
  const [isShowcase, setIsShowcase] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("showcase") === "1" ||
      window.location.hash === "#showcase" ||
      window.location.pathname.endsWith("/showcase")
    );
  });

  useEffect(() => {
    const checkRoute = () => {
      const params = new URLSearchParams(window.location.search);
      setIsShowcase(
        params.get("showcase") === "1" ||
          window.location.hash === "#showcase" ||
          window.location.pathname.endsWith("/showcase"),
      );
    };

    window.addEventListener("popstate", checkRoute);
    window.addEventListener("hashchange", checkRoute);
    return () => {
      window.removeEventListener("popstate", checkRoute);
      window.removeEventListener("hashchange", checkRoute);
    };
  }, []);

  if (isShowcase) {
    return <PrimitiveShowcase />;
  }

  return <App />;
}

void installWebHost().then(() => {
  const container = document.getElementById("root");
  if (container) {
    createRoot(container).render(
      <StrictMode>
        <Root />
      </StrictMode>,
    );
  }
}).catch(() => { /* Host status provides reconnect guidance. */ });

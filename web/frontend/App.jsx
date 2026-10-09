import { BrowserRouter } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { NavMenu } from "@shopify/app-bridge-react";
import Routes from "./Routes";
import { isShopify } from "./platform";

import { QueryProvider, PolarisProvider } from "./components";
import { StandaloneShell } from "./components/StandaloneShell";

export default function App() {
  const pages = import.meta.glob("./pages/**/!(*.test.[jt]sx)*.([jt]sx)", {
    eager: true,
  });
  const { t } = useTranslation();

  return (
    <PolarisProvider>
      <BrowserRouter>
        <QueryProvider>
          {isShopify ? (
            <>
              <NavMenu>
                <a href="/" rel="home" />
                <a href="/pagename">{t("NavigationMenu.pageName")}</a>
              </NavMenu>
              <Routes pages={pages} />
            </>
          ) : (
            <StandaloneShell>
              <Routes pages={pages} />
            </StandaloneShell>
          )}
        </QueryProvider>
      </BrowserRouter>
    </PolarisProvider>
  );
}

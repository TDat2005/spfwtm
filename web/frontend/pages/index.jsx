import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { UnifiedWatermarkStudio } from "../components";
import { isShopify } from "../platform";

export default function HomePage() {
  return (
    <Page fullWidth title="Watermark Studio">
      {isShopify && <TitleBar title="Watermark Studio" />}
      <UnifiedWatermarkStudio />
    </Page>
  );
}


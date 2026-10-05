import { Page } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { UnifiedWatermarkStudio } from "../components";

export default function HomePage() {
  return (
    <Page fullWidth title="Watermark Studio">
      <TitleBar title="Watermark Studio" />
      <UnifiedWatermarkStudio />
    </Page>
  );
}


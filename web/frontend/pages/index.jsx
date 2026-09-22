import { Page, Layout } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ProductsCard, WatermarkStudio } from "../components";

export default function HomePage() {
  return (
    <Page title="Watermark Studio">
      <TitleBar title="Watermark Studio" />
      <Layout>
        <Layout.Section>
          <ProductsCard />
        </Layout.Section>
        <Layout.Section>
          <WatermarkStudio />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

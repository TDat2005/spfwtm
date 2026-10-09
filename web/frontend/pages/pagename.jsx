import { Card, Page, Layout, TextContainer, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useTranslation } from "react-i18next";
import { isShopify } from "../platform";

export default function PageName() {
  const { t } = useTranslation();
  return (
    <Page>
      {isShopify && (
        <TitleBar title={t("PageName.title")}>
          <button variant="primary" onClick={() => console.log("Primary action")}>
            {t("PageName.primaryAction")}
          </button>
          <button onClick={() => console.log("Secondary action")}>
            {t("PageName.secondaryAction")}
          </button>
        </TitleBar>
      )}
      <Layout>
        <Layout.Section>
          <Card sectioned>
            <Text variant="headingMd" as="h2">
              {t("PageName.heading")}
            </Text>
            <TextContainer>
              <p>{t("PageName.body")}</p>
            </TextContainer>
          </Card>
          <Card sectioned>
            <Text variant="headingMd" as="h2">
              {t("PageName.heading")}
            </Text>
            <TextContainer>
              <p>{t("PageName.body")}</p>
            </TextContainer>
          </Card>
        </Layout.Section>
        <Layout.Section secondary>
          <Card sectioned>
            <Text variant="headingMd" as="h2">
              {t("PageName.heading")}
            </Text>
            <TextContainer>
              <p>{t("PageName.body")}</p>
            </TextContainer>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

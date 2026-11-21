import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState } from "../components/Form";
import { Page } from "../components/Page";

export function UsagePage() {
  const { t } = useTranslation();
  return (
    <Page title={t("usage.title")}>
      <Card>
        <EmptyState
          icon="bar_chart"
          title={t("usage.emptyTitle")}
          desc={t("usage.emptyDesc")}
        />
      </Card>
    </Page>
  );
}

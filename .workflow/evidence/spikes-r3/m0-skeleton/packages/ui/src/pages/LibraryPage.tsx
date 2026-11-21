import { useTranslation } from "react-i18next";
import { Card } from "../components/Card";
import { EmptyState } from "../components/Form";
import { Button } from "../components/Icon";
import { Page } from "../components/Page";
import { useToast } from "../components/Toast";

export function LibraryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <Page title={t("library.title")}>
      <Card>
        <EmptyState
          icon="local_library"
          title={t("library.emptyTitle")}
          desc={t("library.emptyDesc")}
          actions={
            <>
              <Button
                variant="primary"
                icon="add"
                onClick={() => toast("M1a 才有新建工程", "add")}
              >
                {t("library.newProject")}
              </Button>
              <Button
                variant="neu"
                icon="upload_file"
                onClick={() => toast("M1a 才有导入", "upload_file")}
              >
                {t("library.importPackage")}
              </Button>
            </>
          }
        />
      </Card>
    </Page>
  );
}

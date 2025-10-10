import { useEffect } from "react";
import { Center, Title } from "@mantine/core";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import ActionsList from "../components/actions/ActionsList";

const PAGE_SLUG = PAGE_SLUGS.actionsDirectory;

const ActionsDirectory = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(navigateToPage(props.title));
  }, [dispatch, props.title]);

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <div>
        <Center>
          <Title order={2}>{props.title}</Title>
        </Center>
        <ActionsList />
      </div>
    </PageAccessGuard>
  );
};

export default ActionsDirectory;

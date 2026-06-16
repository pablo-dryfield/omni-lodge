import type { ReactNode } from "react";
import { Anchor, Container, Paper, Stack, Text, Title } from "@mantine/core";
import { Link } from "react-router-dom";

type LegalPageLayoutProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
};

const LegalPageLayout = ({ eyebrow = "OmniLodge", title, description, children }: LegalPageLayoutProps) => {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7f7fb 0%, #eef3f9 100%)",
        padding: "48px 16px",
      }}
    >
      <Container size="sm">
        <Paper
          radius="xl"
          p={{ base: "lg", sm: "xl" }}
          shadow="sm"
          style={{
            border: "1px solid rgba(148, 163, 184, 0.25)",
            background: "rgba(255, 255, 255, 0.96)",
          }}
        >
          <Stack gap="lg">
            <Stack gap={6}>
              <Text tt="uppercase" fw={700} size="xs" c="dimmed" style={{ letterSpacing: "0.12em" }}>
                {eyebrow}
              </Text>
              <Title order={1}>{title}</Title>
              {description ? (
                <Text c="dimmed" style={{ lineHeight: 1.65 }}>
                  {description}
                </Text>
              ) : null}
            </Stack>

            <div>{children}</div>

            <Text size="sm" c="dimmed">
              <Anchor component={Link} to="/privacy-policy">
                Privacy policy
              </Anchor>
              {" · "}
              <Anchor component={Link} to="/terms">
                Terms
              </Anchor>
              {" ? "}
              <Anchor component={Link} to="/data-deletion">
                Data deletion
              </Anchor>
            </Text>
          </Stack>
        </Paper>
      </Container>
    </div>
  );
};

export default LegalPageLayout;

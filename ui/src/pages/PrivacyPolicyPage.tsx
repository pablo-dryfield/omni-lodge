import { List, Stack, Text, Title } from "@mantine/core";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import LegalPageLayout from "../components/legal/LegalPageLayout";

const PrivacyPolicyPage = ({ title }: GenericPageProps) => {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title={title}
      description="OmniLodge Android and related mobile operational workflows."
    >
      <Stack gap="lg">
        <Text c="dimmed">Effective date: June 8, 2026</Text>

        <Text style={{ lineHeight: 1.75 }}>
          OmniLodge provides a mobile operations application for authorized staff and internal users.
          This Privacy Policy explains what information the OmniLodge Android app may process, how
          that information is used, and what choices are available to users.
        </Text>

        <Stack gap={6}>
          <Title order={3}>1. Information We Process</Title>
          <Text>The current Android app may process the following categories of information:</Text>
          <List spacing="xs">
            <List.Item>Account login information such as username or email address and password entered at sign in</List.Item>
            <List.Item>Session and access information such as a backend-issued authentication token, internal user ID, and role information</List.Item>
            <List.Item>Profile information such as username, first name, last name, and profile photo if present in the OmniLodge system</List.Item>
            <List.Item>Notification information assigned to the signed-in user</List.Item>
            <List.Item>Operational workspace data exposed through the OmniLodge backend, including booking, manifest, and task-planner records</List.Item>
            <List.Item>Customer-facing booking data made available in operational flows, including names, phone numbers, booking platform, product, status, counts, and extras where returned by the backend</List.Item>
          </List>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>2. How We Use Information</Title>
          <List spacing="xs">
            <List.Item>Authenticate users and maintain signed-in sessions</List.Item>
            <List.Item>Show role-appropriate operational data and navigation</List.Item>
            <List.Item>Display notifications, profile details, booking activity, and task-planner records</List.Item>
            <List.Item>Support internal hospitality, staffing, and daily operations workflows</List.Item>
            <List.Item>Protect the service and investigate technical issues or misuse</List.Item>
          </List>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>3. Data Stored on Device</Title>
          <Text style={{ lineHeight: 1.75 }}>
            The Android app stores a session token in app-private device storage so the user can
            remain signed in between launches. The app does not include advertising SDKs or
            third-party analytics SDKs in the current codebase.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>4. Sharing and Access</Title>
          <Text style={{ lineHeight: 1.75 }}>
            The app communicates with the OmniLodge backend API to authenticate users and retrieve
            or update operational data. Information may be accessible to authorized administrators,
            managers, and staff users according to permissions configured in the OmniLodge platform.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>5. Permissions and Device Access</Title>
          <Text style={{ lineHeight: 1.75 }}>
            The current Android app requires network access to communicate with the OmniLodge
            backend. Based on the current implementation, it does not request runtime access to
            location, contacts, camera, microphone, SMS, call logs, or calendar data.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>6. Data Retention</Title>
          <Text style={{ lineHeight: 1.75 }}>
            Most data shown in the Android app is retrieved from the OmniLodge backend. Retention of
            operational records is governed by backend systems and internal business processes.
            Locally stored session data may remain on the device until the user signs out, the app
            clears the session, or the app data is removed.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>7. Security</Title>
          <Text style={{ lineHeight: 1.75 }}>
            We use technical and organizational measures intended to protect information processed
            through the app. However, no method of transmission or storage is completely secure, and
            absolute security cannot be guaranteed.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>8. User Choices</Title>
          <List spacing="xs">
            <List.Item>Users may sign out of the app, which clears the locally stored session token</List.Item>
            <List.Item>Users may contact their OmniLodge administrator regarding access, correction, or removal requests related to platform data</List.Item>
          </List>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>9. Children</Title>
          <Text style={{ lineHeight: 1.75 }}>
            The OmniLodge Android app is intended for authorized staff and internal operational use
            and is not directed to children.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>10. Changes to This Policy</Title>
          <Text style={{ lineHeight: 1.75 }}>
            This Privacy Policy may be updated from time to time. The latest version should be
            published at this page and referenced from relevant product materials and app store
            listings.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>11. Contact</Title>
          <Text style={{ lineHeight: 1.75 }}>
            For privacy questions related to OmniLodge and the Android application, contact:
          </Text>
          <List spacing="xs">
            <List.Item>Pablo Jose Cabrera Camposeco</List.Item>
            <List.Item>pjcampo1@gmail.com</List.Item>
          </List>
        </Stack>

        <Text
          style={{
            lineHeight: 1.75,
            padding: '14px 16px',
            borderRadius: 14,
            background: '#fff6dd',
            border: '1px solid #f0d48b',
            color: '#6a5514',
          }}
        >
          This page reflects the current Android app behavior in the repository as of June 8, 2026.
        </Text>
      </Stack>
    </LegalPageLayout>
  );
};

export default PrivacyPolicyPage;

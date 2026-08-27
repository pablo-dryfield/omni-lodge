import { List, Stack, Text, Title } from "@mantine/core";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import LegalPageLayout from "../components/legal/LegalPageLayout";

const PrivacyPolicyPage = ({ title }: GenericPageProps) => {
  return (
    <LegalPageLayout
      eyebrow="Legal"
      title={title}
      description="OmniLodge mobile, web, and connected operational workflows."
    >
      <Stack gap="lg">
        <Text c="dimmed">Effective date: August 27, 2026</Text>

        <Text style={{ lineHeight: 1.75 }}>
          OmniLodge provides mobile and web tools for authorized staff and internal users. It may
          also connect a business&apos;s existing WhatsApp Business App number to Meta&apos;s WhatsApp
          Cloud API when an authorized administrator chooses to do so. This Privacy Policy explains
          what information OmniLodge may process, how it is used, and what choices are available.
        </Text>

        <Stack gap={6}>
          <Title order={3}>1. Information We Process</Title>
          <Text>OmniLodge may process the following categories of information:</Text>
          <List spacing="xs">
            <List.Item>Account login information such as username or email address and password entered at sign in</List.Item>
            <List.Item>Session and access information such as a backend-issued authentication token, internal user ID, and role information</List.Item>
            <List.Item>Profile information such as username, first name, last name, and profile photo if present in the OmniLodge system</List.Item>
            <List.Item>Notification information assigned to the signed-in user</List.Item>
            <List.Item>Operational workspace data exposed through the OmniLodge backend, including booking, manifest, and task-planner records</List.Item>
            <List.Item>Customer-facing booking data made available in operational flows, including names, phone numbers, booking platform, product, status, counts, and extras where returned by the backend</List.Item>
            <List.Item>For a connected WhatsApp Business number, recent normalized message content, provider message and reply-context identifiers, message type and direction, timestamps, delivery, edit, or revocation state, contact display name, a keyed pseudonymous contact identifier, and the last four digits of the contact&apos;s phone number</List.Item>
            <List.Item>During webhook processing, sender and recipient WhatsApp identifiers and normalized message events may be held temporarily in an encrypted processing queue; after successful processing, the retained message record replaces the full contact identifier with the keyed contact identifier and phone-number suffix</List.Item>
            <List.Item>WhatsApp connection metadata such as the selected WhatsApp Business Account and phone-number identifiers, webhook delivery hashes, synchronization request identifiers and status, connection health, and encrypted access credentials</List.Item>
          </List>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>2. How We Use Information</Title>
          <List spacing="xs">
            <List.Item>Authenticate users and maintain signed-in sessions</List.Item>
            <List.Item>Show role-appropriate operational data and navigation</List.Item>
            <List.Item>Display notifications, profile details, booking activity, and task-planner records</List.Item>
            <List.Item>Support internal hospitality, staffing, and daily operations workflows</List.Item>
            <List.Item>Process recent inbound messages and outbound WhatsApp Business App message echoes for an administrator-authorized business number and prepare private, read-only operational summaries</List.Item>
            <List.Item>If the administrator elects Meta&apos;s history-sharing option, process eligible recent message history for the same operational summaries</List.Item>
            <List.Item>Maintain and diagnose the administrator-authorized WhatsApp connection, including webhook and synchronization status</List.Item>
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
            Pablo Jose Cabrera Camposeco, located in Poland, is responsible for deciding how and why
            personal data is processed through OmniLodge. OmniLodge applications communicate with
            the OmniLodge backend API to authenticate users and retrieve or update operational data.
            Information may be accessible to authorized administrators, managers, and staff users
            according to permissions configured in the OmniLodge platform. WhatsApp brief data is
            exposed through a separate bearer-authenticated, read-only API configured for the
            authorized brief consumer. When a business administrator connects WhatsApp, Meta
            Platforms, Inc. processes WhatsApp account, authorization, message, media, and webhook
            data as required to provide the WhatsApp Business Platform.
            Cloudflare provides network delivery and security services for OmniLodge and may process
            request metadata and webhook payloads while delivering them to the OmniLodge backend.
            Google Drive stores OmniLodge database backup archives, which may contain WhatsApp data
            that was present in the database when a backup was created.
            When an administrator enables the scheduled morning brief, selected recent WhatsApp
            message data is provided to OpenAI services solely to generate the requested private
            operational summary. These providers process data under their applicable service terms
            and data-protection commitments. OmniLodge does not sell WhatsApp message data or use it
            for advertising.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>5. Permissions and Device Access</Title>
          <Text style={{ lineHeight: 1.75 }}>
            The Android app requires network access to communicate with the OmniLodge backend. Based
            on the current implementation, it does not request runtime access to location, contacts,
            camera, microphone, SMS, call logs, or calendar data. WhatsApp connection authorization
            is completed by an administrator through Meta&apos;s official Embedded Signup flow; OmniLodge
            never asks the administrator to disclose a Meta password or WhatsApp verification code.
          </Text>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>6. Data Retention</Title>
          <Text style={{ lineHeight: 1.75 }}>
            Most operational data is retrieved from the OmniLodge backend and retained according to
            internal business processes. The normalized WhatsApp message store uses a configurable
            retention window of one to seven days, measured from each message&apos;s timestamp, and an
            hourly purge removes records after they leave that window. Encrypted webhook processing
            jobs are deleted after successful processing; failed or unprocessed jobs are subject to
            a seven-day queue-retention limit and the same hourly purge. Synced WhatsApp address-book data,
            media files, and Meta media identifiers are not retained. Connection-health, security,
            and webhook delivery records may be retained separately when needed to protect or operate
            the service. Data removed from the live database may remain in Google Drive backup copies
            until those backup copies are deleted; backup copies are used for service recovery.
            Locally stored session data may remain on a device until the user signs out, the app
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
            <List.Item>WhatsApp conversation participants and administrators of a connected business may use the published data-deletion page to request deletion of WhatsApp-related data</List.Item>
            <List.Item>A business administrator may choose whether to share eligible message history during Meta&apos;s onboarding flow</List.Item>
          </List>
        </Stack>

        <Stack gap={6}>
          <Title order={3}>9. Children</Title>
          <Text style={{ lineHeight: 1.75 }}>
            OmniLodge is intended for authorized staff and internal operational use and is not
            directed to children.
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
            For privacy questions related to OmniLodge, including its WhatsApp integration, contact:
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
          This page reflects the current OmniLodge application and WhatsApp integration behavior as
          of August 27, 2026.
        </Text>
      </Stack>
    </LegalPageLayout>
  );
};

export default PrivacyPolicyPage;

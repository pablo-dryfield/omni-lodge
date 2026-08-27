declare module "*.css";

type MetaFacebookLoginResponse = {
  authResponse?: {
    code?: string;
  };
  status?: string;
};

type MetaFacebookSdk = {
  init: (options: {
    appId: string;
    autoLogAppEvents: boolean;
    cookie: boolean;
    xfbml: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: MetaFacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        setup: Record<string, never>;
        featureType: "whatsapp_business_app_onboarding";
        sessionInfoVersion: 3;
      };
    },
  ) => void;
};

interface Window {
  FB?: MetaFacebookSdk;
  fbAsyncInit?: () => void;
}

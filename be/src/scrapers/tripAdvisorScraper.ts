import axios from 'axios';

export type TripAdvisorReview = {
  channel: string;
  name?: string;
  title?: string;
  description?: string;
  score?: number;
  date?: string;
  reviewId?: string;
  profilePhotoUrl?: string;
};

type TripAdvisorGraphQLCard = Record<string, unknown> & {
  __typename?: string;
  bubbleRatingNumber?: number;
  bubbleRatingText?: { text?: string };
  cardTitle?: { text?: string };
  cardText?: { text?: string };
  cardSubtitle?: { text?: string };
  translation?: { text?: string };
  publishDate?: { text?: string };
  cardLink?: {
    trackingContext?: string;
    webRoute?: {
      typedParams?: {
        webLinkUrl?: string;
      };
    };
  };
  authorCard?: Record<string, unknown> & {
    displayName?: { text?: string };
  };
};

const GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';

const HARDCODED_HEADERS = {
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/json',
  priority: 'u=1, i',
  'sec-ch-device-memory': '8',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-arch': '"x86"',
  'sec-ch-ua-full-version-list': '"Chromium";v="142.0.7444.177", "Google Chrome";v="142.0.7444.177", "Not_A Brand";v="99.0.0.0"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-model': '""',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'same-origin',
  'sec-fetch-site': 'same-origin',
  cookie:
    'TAUnique=%1%enc%3AfP3UWefxDLGshPonIpy3mbk%2FIgjcWHKTsHpRcTPjgwDrPpCRcPmdOp0gqPK3zLEENox8JbUSTxk%3D; TASameSite=1; OptanonAlertBoxClosed=2025-03-26T12:56:49.238Z; eupubconsent-v2=CQO4BZgQO4BZgAcABBENBiFsAP_gAEPgACiQK8tX_C5ebWli8TZUIbtkaYwP55gz4kQhBgaIEewFwBOG7BgCB2EwNAR4JiACGBAAkiDBAQNlHABUAQAAAIgRiSCMYEyEgTNKJKBAiFMRI0NYCBxmmoFDWQCY5kqssxcxmBeAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAA_Ybff5Pn__ul_-_X_vf_n37v942CvIBJgoVEEJYEgARKBhBAgAEEYQEUAAIAAEgKACAEAQBOQIAB1hIAAACAAEAAAAAIIAAQAACQAIRAAAAQCAAAAQCAAMAAAYCAAgQAAQAWAAEAAIBoCAQEEAgGACBiBQaYEgAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD6MrTAsHzBM0pgGQBEEZGSbEJv2gFAgBIAOgAuADZAIgAYQBOgC5AG2AQOCABgAdACuAIgAYQBOgEDgwAcAHQAXABsgEQAMIAuQCBwgAOADoAbIBEADCAJ0AXIBA4UADAC4AYQCBwwAEAYQCBw4AMADoAiABhAE6AQOAiuQABAGEAgcSABgEQAMIBA4oAFAB0ARAAwgCdAIHAAA.f_wACHwAAAAA; OTAdditionalConsentString=1~43.46.55.61.70.83.89.93.108.117.122.124.135.143.144.147.149.159.192.196.211.228.230.239.259.266.286.291.311.318.320.322.323.327.367.371.385.394.407.415.424.430.436.445.486.491.494.495.522.523.540.550.559.560.568.574.576.584.587.591.737.802.803.820.821.839.864.899.904.922.931.938.979.981.985.1003.1027.1031.1040.1046.1051.1053.1067.1092.1095.1097.1099.1107.1135.1143.1149.1152.1162.1166.1186.1188.1205.1215.1226.1227.1230.1252.1268.1270.1276.1284.1290.1301.1307.1312.1345.1356.1375.1403.1415.1416.1421.1423.1440.1449.1455.1495.1512.1516.1525.1540.1548.1555.1558.1570.1577.1579.1583.1584.1591.1603.1616.1638.1651.1653.1659.1667.1677.1678.1682.1697.1699.1703.1712.1716.1721.1725.1732.1745.1750.1765.1782.1786.1800.1810.1825.1827.1832.1838.1840.1842.1843.1845.1859.1866.1870.1878.1880.1889.1899.1917.1929.1942.1944.1962.1963.1964.1967.1968.1969.1978.1985.1987.2003.2008.2027.2035.2039.2047.2052.2056.2064.2068.2072.2074.2088.2090.2103.2107.2109.2115.2124.2130.2133.2135.2137.2140.2147.2156.2166.2177.2186.2205.2213.2216.2219.2220.2222.2225.2234.2253.2279.2282.2292.2305.2309.2312.2316.2322.2325.2328.2331.2335.2336.2343.2354.2358.2359.2370.2376.2377.2387.2400.2403.2405.2407.2411.2414.2416.2418.2425.2440.2447.2461.2465.2468.2472.2477.2481.2484.2486.2488.2493.2498.2501.2510.2517.2526.2527.2532.2535.2542.2552.2563.2564.2567.2568.2569.2571.2572.2575.2577.2583.2584.2596.2604.2605.2608.2609.2610.2612.2614.2621.2628.2629.2633.2636.2642.2643.2645.2646.2650.2651.2652.2656.2657.2658.2660.2661.2669.2670.2677.2681.2684.2687.2690.2695.2698.2713.2714.2729.2739.2767.2768.2770.2772.2784.2787.2791.2792.2798.2801.2805.2812.2813.2816.2817.2821.2822.2827.2830.2831.2834.2838.2839.2844.2846.2849.2850.2852.2854.2860.2862.2863.2865.2867.2869.2873.2874.2875.2876.2878.2880.2881.2882.2883.2884.2886.2887.2888.2889.2891.2893.2894.2895.2897.2898.2900.2901.2908.2909.2916.2917.2918.2919.2920.2922.2923.2927.2929.2930.2931.2940.2941.2947.2949.2950.2956.2958.2961.2963.2964.2965.2966.2968.2973.2975.2979.2980.2981.2983.2985.2986.2987.2994.2995.2997.2999.3000.3002.3003.3005.3008.3009.3010.3012.3016.3017.3018.3019.3028.3034.3038.3043.3052.3053.3055.3058.3059.3063.3066.3068.3070.3073.3074.3075.3076.3077.3089.3090.3093.3094.3095.3097.3099.3100.3106.3109.3112.3117.3119.3126.3127.3128.3130.3135.3136.3145.3150.3151.3154.3155.3163.3167.3172.3173.3182.3183.3184.3185.3187.3188.3189.3190.3194.3196.3209.3210.3211.3214.3215.3217.3219.3222.3223.3225.3226.3227.3228.3230.3231.3234.3235.3236.3237.3238.3240.3244.3245.3250.3251.3253.3257.3260.3270.3272.3281.3288.3290.3292.3293.3296.3299.3300.3306.3307.3309.3314.3315.3316.3318.3324.3328.3330.3331.3531.3731.3831.4131.4531.4631.4731.4831.5231.6931.7235.7831.7931.8931.9731.10231.10631.10831.11031.11531.12831.13632.13731.14034.14237.14332.15731.16831.16931.21233.23031.25131.25731.25931.26031.26831.27731.27831.28031.28731.28831.29631.32531.33631.34231.34631.36831.39131.39531.40632.41531; _ga=GA1.1.366337370.1742993810; _cc=AW5HQCzl03lgDjTWzQpTvVuF; _cid_cc=AW5HQCzl03lgDjTWzQpTvVuF; VRMCID=%1%V1*id.10568*llp.%2FHotel_Review-g295366-d7343302-Reviews-Bigfoot_Hostel_Antigua-Antigua_Sacatepequez_Department%5C.html*e.1750232956754; TASSK=enc%3AACZltB%2FJY4KQImVbE%2BgMO4LqXZS%2BfTmYdiw5ApSB73afGlHvvsPKSkQfRyCqs41P9jVaR%2BKz%2FkINIdEQDsxDPrQabqZ9Dey3hegrmFzBhpZ7X3Z2QO1YUOytOMld2gkcLg%3D%3D; TATrkConsent=eyJvdXQiOiIiLCJpbiI6IkFMTCJ9; pbjs_sharedId=ebb53b8b-fb1e-41a3-bd1f-50314b05b8fc; pbjs_sharedId_cst=7Sw6LNcsjg%3D%3D; _lr_env_src_ats=false; _gcl_au=1.1.1680183803.1763569402; pbjs_unifiedID=%7B%22TDID_LOOKUP%22%3A%22FALSE%22%2C%22TDID_CREATED_AT%22%3A%222025-11-19T16%3A23%3A22%22%7D; pbjs_unifiedID_cst=7Sw6LNcsjg%3D%3D; PMC=V2*MS.43*MD.20251119*LD.20251119; TASID=6B4634CE9F80266A3D5E264A6AE34D3A; TAAUTHEAT=Z8Wq79sQUoN-5acAABQC3I3IpT7XQpOMdOQw2Q027UoJL2pMVCMQ3908he_xH5hQtMHdWi0jV9GQRt4vo77wDr8FSBwYDViPOPnAOImYmOqUS2MR6r5NQtXQPjx8ncpWZD5CmByUQep1vHy_3aRUAyBLbkCCOTk16BqvK5s7DZGerYp5dYr7TYcmtPa_crWfj1CT93DDt6Z6cRsUcW6BgWrUQmXlRpKvdXgh; TADCID=O0DFAmVfkw_4OftjABQCJ4S5rDsRRMescG99HippfooyLzA0DNQcIs6S1j8KxzzkTPxn6jZ5LsL38OEJM94E5ehDRGixiGObI3s; PAC=ALk5zHsXao2WilRi2Y1Lu7ZsCSq14BATyMehGNuLNVP5QUzdB7VLGRcGlZT2gVetRYGITPYZF2TZUJBj1OXooEwARwrNBG3v52eTFYqeNLGyiJho2kJgHxuJpfDBQJJOc5TQP8oP7cYUP7B1qSaAjjZAOJV_BHZLGN1DXEGnSp8osJbS13S_RdXj-QGXG4iRLb4QFd3sIFu-sFjx4jLj-b2wnMppi-xkyp6IV3uzjw6s7NdKlxGmQKTGaWvY3W5i5zNRhAXkuHok6_tC-7-KeXIbs1YyEon5a3eohjfhiR02; SRT=TART_SYNC; TART=%1%enc%3AqRCBpzvDKEq%2BAvmz5PpOg8OjXHb0ngOvuCB0887hZkGmakn9yPdFxK%2BnTaE7xfhR48W0scdiLnw%3D; _lr_retry_request=true; AMZN-Token=v2FweIBEZ3U4RlFScldaTVhtTTJ6VHNXN2Z3QStvcXoxVFBhS2tLLzBoR09peWFFaVlyOWx6czVSZmErTFdzSWdmTVF3a0lFNnM0WnBJTjZCYUFVQnVCYVRIM0NqZmZ6ZUFNQzhwMjljeTRnZlA5SURxV0pPYUhmL21JQlhNRHNDdXhyUWJrdgFiaXZ4HDc3KzlNVEVvNzcrOVNBRHZ2NzBHNzcrOUtYRT3/; __gads=ID=eefc04c6957dacc2:T=1742993810:RT=1765422851:S=ALNI_MZhohxtAYFJ5UCFRoFX13g8dBXmVw; __gpi=UID=0000106fe9292898:T=1742993810:RT=1765422851:S=ALNI_MYj7kSdFZCHddfk8Ki6CRZBADdSgQ; __eoi=ID=1e6662c27989949e:T=1763569404:RT=1765422851:S=AA-AfjZFnancQIVLkg75vJXmefWv; _lr_sampling_rate=100; OptanonConsent=isGpcEnabled=0&datestamp=Thu+Dec+11+2025+04%3A16%3A46+GMT%2B0100+(Central+European+Standard+Time)&version=202405.2.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=6135A627D3CD572BCDEBC6CE9E447270&interactionCount=2&isAnonUser=1&landingPath=NotLandingPage&groups=C0001%3A1%2CC0004%3A1%2CC0002%3A1%2CC0003%3A1%2CV2STACK42%3A1&intType=1&geolocation=PL%3B12&AwaitingReconsent=false; _gcl_aw=GCL.1765423007.undefined; TASession=V2ID.6B4634CE9F80266A3D5E264A6AE34D3A*SQ.3*LS.AttractionProductReview*HS.recommended*ES.popularity*DS.5*SAS.popularity*FPS.oldFirst*TS.6135A627D3CD572BCDEBC6CE9E447270*FA.1*DF.0*TRA.true; datadome=p9cQjPEM18Yc08qW77UmRJW7IpJP9q~XBEX1lAAI0Vhd7IIIRKy4Hc9Imbo4RzC8aTS6xQINXnpuMrw4DQ0erbwSy3waX1e0X0_SR0XgEqjPjyipAyCphoygAn3hMoNz; _ga_QX0Q50ZC9P=GS2.1.s1765422851$o15$g1$t1765423227$j60$l0$h0; __vt=Vc6A6l9IuTQeEotJABQCT24E-H_BQo6gx1APGQJPtzoP2nWqQYGTJoYe8swmdkw1PBC5tQ56iBHbu4tqVPnyHWSaqa4wyNZyjRFgRxWlXNrRNEMHgQaKH6YzDein4hq5PVEt7EHQO-XxSUKioPZMOEIFO96d65ZPFG0bUqWonqwKADB_avJycGzPC-JmaYsSi92H6ILk9bjzEowakZLO1U_uAcMv9pBJP-QoqtjAT_6MCGX2fYpq697rtJbGOaf23plGrDK4upZpzQZ-JieP5oQZc9Q835-eVV-kdQDMmhUlX2mLlPgfM9T5Ad87V5W3yGfwv-T9IZUREuRNZXadH8k9ch2EgWa4anyYbhOwSXJx-7zrM2CMssdYLKnQVTxp9lxWrlQoWDMauI_X_c3zoWF5IAKK2g',
  Referer:
    'https://www.tripadvisor.com/AttractionProductReview-g274772-d13998447-or10-Pub_Crawl_Krawl_Through_Krakow-Krakow_Lesser_Poland_Province_Southern_Poland.html',
};

const HARDCODED_BODY = String.raw`[{"variables":{"page":"AttractionProductReview","pos":"en-US","parameters":[{"key":"geoId","value":"274772"},{"key":"detailId","value":"13998447"},{"key":"offset","value":"r10"}],"factors":["TITLE","META_DESCRIPTION","MASTHEAD_H1","MAIN_H1","IS_INDEXABLE","RELCANONICAL"],"route":{"page":"AttractionProductReview","params":{"geoId":274772,"detailId":13998447,"offset":"r10"}},"currencyCode":"USD"},"extensions":{"preRegisteredQueryId":"18d4572907af4ea5"}},{"variables":{"request":{"tracking":{"screenName":"AttractionProductReview","pageviewUid":"9ad1c4a9-424b-44b4-a751-16e35233ca7b"},"routeParameters":{"contentType":"attraction_product","contentId":"13998447"},"clientState":{"userInput":[{"inputKey":"query","inputValues":[""]},{"inputKey":"language","inputValues":["all"]}]},"updateToken":"eyJ2ZXIiOiJ2MiIsInR5cCI6IkpXVCIsImFsZyI6IkVTMjU2IiwidmVyc2lvbiI6IjEifQ.eyJvYmplY3QiOiJ7XCJAY1wiOlwiLlBhZ2luZ1VwZGF0ZVRva2VuXCIsXCJjbHVzdGVySWRzXCI6W1wiUE9JX1JFVklFV1NfV0VCXCJdLFwicHJvdmlkZXJVcGRhdGVUb2tlbnNcIjp7XCJUUkFOU0xBVEVfUkVWSUVXU1wiOntcIkBjXCI6XCJjb20udHJpcGFkdmlzb3Iuc2VydmljZS5hcHMuYWRhcHRlcnMuaG90ZWxzLlRyYW5zbGF0ZVJldmlld3NUb2tlblwiLFwic2hvdWxkVHJhbnNsYXRlXCI6dHJ1ZSxcInJldmlld0lkc1wiOlsxMDQwOTE2OTAxLDEwNDA5MTYzMjUsMTA0MDg5NjM5OSwxMDQwODk1MTkxLDEwNDA4OTQxNDYsMTA0MDg3MDMzMSwxMDQwODU4NjM0LDEwNDA3NTY2MTQsMTA0MDc1NDIyMywxMDQwNTM3MDcwXSxcInRvdGFsQ291bnRcIjoxNTQyLFwic2hvd1RyYW5zbGF0ZUhlYWRlclwiOnRydWUsXCJmYXZvcml0ZVJldmlld0lkXCI6bnVsbH0sXCJXRUJfUkVWSUVXU19GSUxURVJcIjp7XCJAY1wiOlwiY29tLnRyaXBhZHZpc29yLnNlcnZpY2UuYXBzLndlYnNhbmRib3gubW9kZWwucmV2aWV3c2FuZHFhLldlYlJldmlld3NGaWx0ZXJUb2tlblwiLFwic2VsZWN0ZWRGaWx0ZXJzXCI6e1wiTEFOR1VBR0VcIjpbXCJhbGxcIl0sXCJVU0VSX1FVRVJZXCI6W1wiXCJdfX19LFwicGFnZUluZGV4XCI6MTAsXCJ0eXBlXCI6XCJQQUdJTkFUSU9OXCIsXCJwb2xsaW5nU2VxdWVuY2VOdW1cIjowfSJ9.MzJlMjUwMzMtNTIyNi00NmRkLThmNTQtNGMxYjNlMzMwNjhmLk1FVUNJUUQ1Ml9rYWJNUWYyY08xMnNTanBQZUZJWVB6ckhjdmozVGEzMmJZRXVpd3dRSWdISWJpOVRUX21kS0h0ZV9QNE5ReHVJdm5yUjNQVHNjeE15Ylk5S1NVN2pJ"},"commerce":{},"sessionId":"6B4634CE9F80266A3D5E264A6AE34D3A","tracking":{"screenName":"AttractionProductReview","pageviewUid":"9ad1c4a9-424b-44b4-a751-16e35233ca7b"},"currency":"USD","currentGeoPoint":null,"unitLength":"MILES"},"extensions":{"preRegisteredQueryId":"b4bb747617ee99c2"}},{"variables":{"pageName":"AttractionProductReview","relativeUrl":"/AttractionProductReview-g274772-d13998447-or10-Pub_Crawl_Krawl_Through_Krakow-Krakow_Lesser_Poland_Province_Southern_Poland.html","parameters":[{"key":"geoId","value":"274772"},{"key":"detailId","value":"13998447"},{"key":"offset","value":"r10"}],"route":{"page":"AttractionProductReview","params":{"geoId":274772,"detailId":13998447,"offset":"r10"}},"routingLinkBuilding":false},"extensions":{"preRegisteredQueryId":"211573a2b002568c"}},{"variables":{"page":"AttractionProductReview","params":[{"key":"geoId","value":"274772"},{"key":"detailId","value":"13998447"},{"key":"offset","value":"r10"}],"route":{"page":"AttractionProductReview","params":{"geoId":274772,"detailId":13998447,"offset":"r10"}}},"extensions":{"preRegisteredQueryId":"f742095592a84542"}}]`;

const HARDCODED_PAYLOAD = JSON.parse(HARDCODED_BODY) as Record<string, unknown>[];

const traverseForReviewCards = (node: unknown, acc: TripAdvisorGraphQLCard[], seen: WeakSet<object>) => {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((child) => traverseForReviewCards(child, acc, seen));
    return;
  }

  if (typeof node === 'object') {
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    const typed = node as TripAdvisorGraphQLCard;
    if (typed.__typename === 'WebPresentation_ReviewCardWeb') {
      acc.push(typed);
    }

    Object.values(typed).forEach((value) => traverseForReviewCards(value, acc, seen));
  }
};

const pickText = (...values: Array<string | { text?: string } | undefined>): string | undefined => {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'object' && typeof value.text === 'string' && value.text.trim()) {
      return value.text.trim();
    }
  }
  return undefined;
};

const parseReviewDate = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  const sanitized = raw.replace(/•/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = sanitized.replace(/^(Written|Reviewed)\s+/i, '').trim();
  const parsedTime = Date.parse(normalized);
  if (!Number.isNaN(parsedTime)) {
    return new Date(parsedTime).toISOString();
  }
  return undefined;
};

const collectFirstPhotoUrl = (node: unknown): string | undefined => {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const candidate = collectFirstPhotoUrl(entry);
      if (candidate) return candidate;
    }
    return undefined;
  }

  if (typeof node === 'object') {
    const typed = node as Record<string, unknown>;
    if (Array.isArray(typed.photoSizes)) {
      for (const size of typed.photoSizes) {
        if (size && typeof size === 'object') {
          const url = (size as Record<string, unknown>).url;
          if (typeof url === 'string' && url.startsWith('http')) {
            return url;
          }
        }
      }
    }

    if (typed.photo) {
      const nested = collectFirstPhotoUrl(typed.photo);
      if (nested) return nested;
    }

    if (typeof typed.url === 'string' && typed.url.startsWith('http')) {
      return typed.url;
    }

    for (const value of Object.values(typed)) {
      const childCandidate = collectFirstPhotoUrl(value);
      if (childCandidate) return childCandidate;
    }
  }

  return undefined;
};

const extractReviewId = (card: TripAdvisorGraphQLCard): string | undefined => {
  const tracking = typeof card.cardLink?.trackingContext === 'string' ? card.cardLink?.trackingContext : undefined;
  if (tracking) {
    const trackingMatch = tracking.match(/review_(\d+)/i);
    if (trackingMatch) {
      return trackingMatch[1];
    }
  }

  const link = card.cardLink?.webRoute?.typedParams?.webLinkUrl;
  if (typeof link === 'string') {
    const linkMatch = link.match(/-r(\d+)-/i);
    if (linkMatch) {
      return linkMatch[1];
    }
  }

  return undefined;
};

const extractScore = (card: TripAdvisorGraphQLCard): number | undefined => {
  if (typeof card.bubbleRatingNumber === 'number') {
    return card.bubbleRatingNumber;
  }

  const ratingText = pickText(card.bubbleRatingText);
  if (ratingText) {
    const scoreMatch = ratingText.match(/(\d+(?:\.\d+)?)/);
    if (scoreMatch) {
      return Number.parseFloat(scoreMatch[1]);
    }
  }

  return undefined;
};

const normalizeCard = (card: TripAdvisorGraphQLCard): TripAdvisorReview => {
  const description = pickText(card.cardText, card.translation) ?? '';
  const title = pickText(card.cardTitle);
  const reviewerName =
    pickText(card.authorCard?.displayName, card.cardSubtitle) ??
    pickText(card.cardSubtitle) ??
    'TripAdvisor guest';
  const isoDate = parseReviewDate(
    pickText(card.publishDate, card.cardSubtitle, card.bubbleRatingText) ?? undefined,
  );
  const profilePhotoUrl = collectFirstPhotoUrl(card.authorCard) ?? collectFirstPhotoUrl(card);

  return {
    channel: 'Tripadvisor',
    name: reviewerName,
    title,
    description,
    score: extractScore(card),
    date: isoDate,
    reviewId: extractReviewId(card),
    profilePhotoUrl,
  };
};

const extractCardsFromPayload = (payload: unknown): TripAdvisorGraphQLCard[] => {
  const accumulator: TripAdvisorGraphQLCard[] = [];
  traverseForReviewCards(payload, accumulator, new WeakSet());
  return accumulator;
};

export const scrapeTripAdvisor = async (): Promise<TripAdvisorReview[]> => {
  try {
    const response = await axios.post(GRAPHQL_ENDPOINT, HARDCODED_PAYLOAD, {
      headers: HARDCODED_HEADERS,
      timeout: 15000,
    });

    const cards = extractCardsFromPayload(response.data);
    if (!cards.length) {
      console.warn('[TripAdvisor] Hardcoded GraphQL response did not include review cards');
      return [];
    }

    return cards.map(normalizeCard);
  } catch (error) {
    console.error('Error scraping TripAdvisor GraphQL feed:', error);
    return [];
  }
};

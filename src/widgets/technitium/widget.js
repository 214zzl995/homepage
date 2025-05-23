import { asJson } from "utils/proxy/api-helpers";
import genericProxyHandler from "utils/proxy/handlers/generic";

const widget = {
  api: "{url}/api/{endpoint}?token={key}&utc=true",
  proxyHandler: genericProxyHandler,
  mappings: {
    stats: {
      endpoint: "dashboard/stats/get",
      validate: ["response", "status"],
      params: ["type"],
      map: (data) => asJson(data).response?.stats,
    },
  },
};

export default widget;

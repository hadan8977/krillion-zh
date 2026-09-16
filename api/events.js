import { endpoint } from "../backend/http.js";
import { events } from "../backend/service.js";
export default endpoint(["POST"], events);

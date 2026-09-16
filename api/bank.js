import { endpoint } from "../backend/http.js";
import { bank } from "../backend/service.js";
export default endpoint(["GET"], bank);

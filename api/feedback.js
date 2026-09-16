import { endpoint } from "../backend/http.js";
import { feedback } from "../backend/service.js";
export default endpoint(["POST"], feedback);

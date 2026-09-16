import { endpoint } from "../backend/http.js";
import { review } from "../backend/service.js";
export default endpoint(["GET", "POST"], review);

import bodywise from "../images/suppliers/bodywise.svg";
import clf from "../images/suppliers/clf.png";
import healthyFoodBrands from "../images/suppliers/healthy_food_brands.png";
import kent from "../images/suppliers/kent.svg";
import naturesAid from "../images/suppliers/natures_aid.png";
import pravera from "../images/suppliers/pravera.png";
import rio from "../images/suppliers/rio.png";
import suma from "../images/suppliers/suma.svg";

// Keyed by supplier key (the name in lower case). Bodywise makes Natracare,
// so it shows the Natracare logo; Kent is G.B. Kent & Sons (Kent Brushes),
// whose cream logo is recoloured black to show on the white plate; Suma's
// cream logo takes the teal of its own app icon. Suppliers
// without a logo here get a lettered badge.
export const SUPPLIER_LOGOS = {
  bodywise,
  clf,
  "healthy food brands": healthyFoodBrands,
  kent,
  "natures aid": naturesAid,
  pravera,
  rio,
  suma,
};

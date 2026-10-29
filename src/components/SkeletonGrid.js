import * as React from "react";
import { SKELETON_COUNT } from "../constants/dashboard";

const SkeletonGrid = () => (
  <div className="channels">
    {Array.from({ length: SKELETON_COUNT }, (_, i) => (
      <div key={i} className="card skeleton" />
    ))}
  </div>
);

export default SkeletonGrid;

-- CreateIndex
CREATE INDEX "Facility_address_idx" ON "Facility" USING GIN ("address" gin_trgm_ops);

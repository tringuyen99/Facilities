-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityAmenity" (
    "facilityId" TEXT NOT NULL,
    "amenityId" INTEGER NOT NULL,

    CONSTRAINT "FacilityAmenity_pkey" PRIMARY KEY ("facilityId","amenityId")
);

-- CreateIndex
CREATE INDEX "Facility_name_idx" ON "Facility" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_name_key" ON "Amenity"("name");

-- CreateIndex
CREATE INDEX "FacilityAmenity_amenityId_facilityId_idx" ON "FacilityAmenity"("amenityId", "facilityId");

-- AddForeignKey
ALTER TABLE "FacilityAmenity" ADD CONSTRAINT "FacilityAmenity_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityAmenity" ADD CONSTRAINT "FacilityAmenity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import type { FacilityDetail, SearchResponse } from "./schemas.ts";

/**
 * Postgres treats % and _ as LIKE wildcards, and Prisma's `contains` passes
 * them through unescaped — so an unescaped `%` would match every row.
 */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function textFilter(value: string): Prisma.StringFilter {
	return { contains: escapeLike(value), mode: "insensitive" };
}

/**
 * Each supported filter contributes one independent predicate, all ANDed
 * together. The amenity filter is the exception internally: its values are ORed
 * with each other, then the group is ANDed with the rest.
 */
function buildWhere(params: SearchParams): Prisma.FacilityWhereInput {
	const filters: Prisma.FacilityWhereInput[] = [];

	if (params.nameContains !== undefined && params.nameContains !== "") {
		filters.push({ name: textFilter(params.nameContains) });
	}

	if (params.addressContains !== undefined && params.addressContains !== "") {
		filters.push({ address: textFilter(params.addressContains) });
	}

	const amenitiesAnyOf = [...new Set(params.amenityAnyOf ?? [])].filter(
		(name) => name !== "",
	);
	if (amenitiesAnyOf.length > 0) {
		filters.push({
			amenities: { some: { amenity: { name: { in: amenitiesAnyOf } } } },
		});
	}

	return filters.length > 0 ? { AND: filters } : {};
}

interface SearchParams {
	/** Case-insensitive substring match. Wildcards in the value are escaped, not honoured. */
	nameContains?: string;
	addressContains?: string;
	amenityAnyOf?: string[];
	limit: number;
	offset: number;
}

export async function searchFacilities(
	prisma: PrismaClient,
	params: SearchParams,
): Promise<SearchResponse> {
	const where = buildWhere(params);

	const rows = await prisma.facility.findMany({
		where,
		orderBy: [{ name: "asc" }, { id: "asc" }],
		take: params.limit + 1,
		skip: params.offset,
	});

	const hasMore = rows.length > params.limit;

	return {
		data: hasMore ? rows.slice(0, params.limit) : rows,
		pagination: { limit: params.limit, offset: params.offset, hasMore },
	};
}

export async function getFacilityById(
	prisma: PrismaClient,
	id: string,
): Promise<FacilityDetail | null> {
	const facility = await prisma.facility.findUnique({
		where: { id },
		include: { amenities: { select: { amenity: { select: { name: true } } } } },
	});

	if (facility === null) {
		return null;
	}

	const { amenities, ...rest } = facility;
	return {
		...rest,
		amenities: amenities.map((amenity) => amenity.amenity.name),
	};
}

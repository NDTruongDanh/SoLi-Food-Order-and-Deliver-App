import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ItemSearchRowDto,
  RestaurantSummaryDto,
  UnifiedSearchTotalsDto,
} from '../standard/search.dto';
import { RestaurantSearchResultDto } from '../../restaurant/dto/restaurant.dto';
import { AI_SEARCH_MAX_QUERY_LENGTH } from './ai-search.types';

export class AiSearchRequestDto {
  @ApiProperty({
    example: 'high protein food nearby',
    maxLength: AI_SEARCH_MAX_QUERY_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(AI_SEARCH_MAX_QUERY_LENGTH)
  query!: string;

  @ApiPropertyOptional({ example: 10.762622 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: 106.660172 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number;

  @ApiPropertyOptional({ example: 5, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  radiusKm?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AiSearchAppliedFilterDto {
  @ApiProperty({ example: 'proteinMinG' })
  key!: string;

  @ApiProperty({ example: 'Protein >= 25g' })
  label!: string;

  @ApiProperty({
    enum: ['request', 'ai_inferred'],
    example: 'ai_inferred',
  })
  source!: 'request' | 'ai_inferred' | 'system_default';
}

export class AiSearchFollowUpDto {
  @ApiProperty({ example: 'Cheaper' })
  label!: string;

  @ApiProperty({ example: 'high protein food under 50000 nearby' })
  query!: string;
}

export class AiSearchFallbackDto {
  @ApiProperty({
    enum: ['ROUTER_UNAVAILABLE', 'ROUTER_INVALID_RESPONSE', 'EMBEDDING_FAILED'],
    example: 'EMBEDDING_FAILED',
  })
  reason!: string;
}

export class AiSearchItemResultDto extends ItemSearchRowDto {
  @ApiProperty({ example: 87 })
  declare score: number;

  @ApiProperty({
    type: [String],
    example: ['42g protein', '4.6 rating', '1.2 km away'],
  })
  matchReasons!: string[];

  @ApiProperty({ type: () => RestaurantSummaryDto })
  declare restaurant: RestaurantSummaryDto;
}

export class AiSearchResponseDto {
  @ApiProperty({ enum: ['ai', 'classic_fallback'], example: 'ai' })
  mode!: 'ai' | 'classic_fallback';

  @ApiProperty({ example: 'high protein food nearby' })
  query!: string;

  @ApiProperty({ example: 'Showing nearby high-protein food options.' })
  interpretation!: string;

  @ApiProperty({ type: [AiSearchAppliedFilterDto] })
  appliedFilters!: AiSearchAppliedFilterDto[];

  @ApiProperty({ type: [RestaurantSearchResultDto] })
  restaurants!: RestaurantSearchResultDto[];

  @ApiProperty({ type: [AiSearchItemResultDto] })
  items!: AiSearchItemResultDto[];

  @ApiProperty({ type: UnifiedSearchTotalsDto })
  total!: UnifiedSearchTotalsDto;

  @ApiProperty({ type: [AiSearchFollowUpDto] })
  followUps!: AiSearchFollowUpDto[];

  @ApiPropertyOptional({ type: AiSearchFallbackDto, nullable: true })
  fallback!: AiSearchFallbackDto | null;
}

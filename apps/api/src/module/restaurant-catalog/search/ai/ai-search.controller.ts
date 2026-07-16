import { Body, Controller, Post } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AiSearchRequestDto, AiSearchResponseDto } from './ai-search.dto';
import { AiSearchService } from './ai-search.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
export class AiSearchController {
  constructor(private readonly service: AiSearchService) {}

  @Post('ai')
  @AllowAnonymous()
  @ApiOperation({
    summary: 'AI-assisted grounded food search',
    description:
      'Routes a natural-language food search into validated catalog filters and a semantic query, retrieves menu items with pgvector cosine distance, and falls back to classic search when routing or embedding fails.',
  })
  @ApiBody({ type: AiSearchRequestDto })
  @ApiOkResponse({
    description:
      'AI search results with applied filters, match reasons, and follow-up suggestions.',
    type: AiSearchResponseDto,
  })
  search(@Body() body: AiSearchRequestDto) {
    return this.service.search(body);
  }
}

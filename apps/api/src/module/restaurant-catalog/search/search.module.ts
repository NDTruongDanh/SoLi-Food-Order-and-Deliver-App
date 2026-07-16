import { Module } from '@nestjs/common';
import { AiModule } from '@/lib/ai/ai.module';
import { AiSearchController } from './ai/ai-search.controller';
import { AiSearchRepository } from './ai/ai-search.repository';
import { AiSearchService } from './ai/ai-search.service';
import { SearchController } from './standard/search.controller';
import { SearchService } from './standard/search.service';
import { SearchRepository } from './standard/search.repository';
import { DatabaseModule } from '@/drizzle/drizzle.module';
import { AiSearchIndexModule } from './indexing/ai-search-index.module';

@Module({
  imports: [DatabaseModule, AiModule, AiSearchIndexModule],
  controllers: [SearchController, AiSearchController],
  providers: [
    SearchService,
    SearchRepository,
    AiSearchService,
    AiSearchRepository,
  ],
})
export class SearchModule {}
